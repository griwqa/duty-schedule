// Писатель настоящего .xlsx (OOXML) без внешних зависимостей.
//
// Excel умеет читать и HTML-таблицу с расширением .xls, но такой файл не
// является документом Office: его отличает от подделки ZIP-контейнер с
// XML-частями. Здесь части собираются текстом и упаковываются в ZIP методом
// store (без сжатия) — Excel и LibreOffice открывают файл так же, как
// собранный openpyxl. Месяц графика занимает десятки килобайт, поэтому
// отсутствие deflate роли не играет, а несколько сотен строк кода экономятся.

const BORDER_THIN = "thin";
const BORDER_HOLIDAY = "holiday";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function columnLetter(index) {
  let name = "";
  let value = index;
  while (value > 0) {
    const rest = (value - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    value = Math.floor((value - rest) / 26);
  }
  return name;
}

function argb(hex) {
  const digits = String(hex || "").replace("#", "").toUpperCase();
  if (digits.length === 3) {
    return `FF${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
  }
  return `FF${digits.slice(0, 6)}`;
}

function u16(value, out) {
  out.push(value & 255, (value >> 8) & 255);
}

function u32(value, out) {
  out.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function dosStamp(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function zipParts(parts, now = new Date()) {
  const encoder = new TextEncoder();
  const stamp = dosStamp(now);
  const files = parts.map((part) => {
    const data = encoder.encode(part.data);
    return { name: encoder.encode(part.name), data, crc: crc32(data) };
  });

  const bytes = [];
  const offsets = [];
  let offset = 0;
  for (const file of files) {
    offsets.push(offset);
    const header = [];
    u32(0x04034b50, header);
    u16(20, header);
    u16(0x0800, header);
    u16(0, header);
    u16(stamp.time, header);
    u16(stamp.date, header);
    u32(file.crc, header);
    u32(file.data.length, header);
    u32(file.data.length, header);
    u16(file.name.length, header);
    u16(0, header);
    const local = Uint8Array.from(header);
    bytes.push(local, file.name, file.data);
    offset += local.length + file.name.length + file.data.length;
  }

  const directoryStart = offset;
  const directory = [];
  files.forEach((file, index) => {
    const record = [];
    u32(0x02014b50, record);
    u16(20, record);
    u16(20, record);
    u16(0x0800, record);
    u16(0, record);
    u16(stamp.time, record);
    u16(stamp.date, record);
    u32(file.crc, record);
    u32(file.data.length, record);
    u32(file.data.length, record);
    u16(file.name.length, record);
    u16(0, record);
    u16(0, record);
    u16(0, record);
    u16(0, record);
    u32(0, record);
    u32(offsets[index], record);
    directory.push(Uint8Array.from(record));
    directory.push(file.name);
    offset += record.length + file.name.length;
  });

  const end = [];
  u32(0x06054b50, end);
  u16(0, end);
  u16(0, end);
  u16(files.length, end);
  u16(files.length, end);
  u32(offset - directoryStart, end);
  u32(directoryStart, end);
  u16(0, end);
  directory.push(Uint8Array.from(end));

  return new Blob([...bytes, ...directory], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

class Styles {
  constructor() {
    // Индексы 0 и 1 зарезервированы форматом: none и gray125.
    this.fills = [null, "gray125"];
    this.fonts = [{ bold: false, color: null }];
    this.xfs = new Map([["", 0]]);
    this.entries = [{ font: 0, fill: 0, border: 0, align: null }];
  }

  indexOf(list, value) {
    const found = list.findIndex((item) => JSON.stringify(item) === JSON.stringify(value));
    return found === -1 ? list.push(value) - 1 : found;
  }

  id(style) {
    // Выравнивание по центру — как в таблице на странице; левый край
    // включается явно через align: "left".
    const align = style.align || "center";
    const key = [style.fill, style.color, style.bold, style.border, align].join("|");
    const known = this.xfs.get(key);
    if (known !== undefined) return known;
    const font = this.indexOf(
      this.fonts,
      { bold: Boolean(style.bold), color: style.color || null },
    );
    const fill = style.fill ? this.indexOf(this.fills, style.fill) : 0;
    const border = style.border === BORDER_THIN ? 1 : style.border === BORDER_HOLIDAY ? 2 : 0;
    const id = this.entries.length;
    this.entries.push({ font, fill, border, align });
    this.xfs.set(key, id);
    return id;
  }

  toXml() {
    const fonts = this.fonts
      .map(
        (font) =>
          `<font>${font.bold ? "<b/>" : ""}${
            font.color ? `<color rgb="${argb(font.color)}"/>` : ""
          }<sz val="11"/><name val="Calibri"/></font>`,
      )
      .join("");
    const fills = this.fills
      .map((fill) => {
        if (!fill) return '<fill><patternFill patternType="none"/></fill>';
        if (fill === "gray125") return '<fill><patternFill patternType="gray125"/></fill>';
        return `<fill><patternFill patternType="solid"><fgColor rgb="${argb(
          fill,
        )}"/><bgColor indexed="64"/></patternFill></fill>`;
      })
      .join("");
    const borders =
      "<border/>" +
      `<border>${["left", "right", "top", "bottom"]
        .map((edge) => `<${edge} style="thin"><color rgb="FF999999"/></${edge}>`)
        .join("")}</border>` +
      `<border>${["left", "right", "top", "bottom"]
        .map((edge) => `<${edge} style="medium"><color rgb="FFC00000"/></${edge}>`)
        .join("")}</border>`;
    const xfs = this.entries
      .map((entry) => {
        const flags =
          (entry.font ? ' applyFont="1"' : "") +
          (entry.fill ? ' applyFill="1"' : "") +
          (entry.border ? ' applyBorder="1"' : "") +
          (entry.align ? ' applyAlignment="1"' : "");
        const alignment = entry.align
          ? `<alignment horizontal="${entry.align}" vertical="center"/>`
          : "";
        return `<xf numFmtId="0" fontId="${entry.font}" fillId="${entry.fill}" borderId="${
          entry.border
        }" xfId="0"${flags}${alignment ? `>${alignment}</xf>` : "/>"}`;
      })
      .join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<fonts count="${this.fonts.length}">${fonts}</fonts>` +
      `<fills count="${this.fills.length}">${fills}</fills>` +
      `<borders count="3">${borders}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.entries.length}">${xfs}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>"
    );
  }
}

export class Sheet {
  constructor(name = "График") {
    this.name = name.slice(0, 31);
    this.cells = new Map();
    this.widths = [];
    this.heights = [];
    this.freeze = null;
    this.lastRow = 0;
    this.lastColumn = 0;
  }

  set(row, column, value, style = null) {
    const cell = { row, column, value: value ?? "", style: style || null };
    this.cells.set(`${row}:${column}`, cell);
    if (row > this.lastRow) this.lastRow = row;
    if (column > this.lastColumn) this.lastColumn = column;
    return this;
  }

  width(column, value) {
    this.widths[column - 1] = value;
    return this;
  }

  height(row, value) {
    this.heights[row - 1] = value;
    return this;
  }

  freezeAt(column, row) {
    this.freeze = { column, row };
    return this;
  }

  cellXml(cell, styles) {
    const reference = `${columnLetter(cell.column)}${cell.row}`;
    const styleId = cell.style ? styles.id(cell.style) : 0;
    const attributes = styleId ? ` s="${styleId}"` : "";
    if (cell.value === "") return `<c r="${reference}"${attributes}/>`;
    if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
      return `<c r="${reference}"${attributes}><v>${cell.value}</v></c>`;
    }
    const text = escapeXml(cell.value);
    const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
    return `<c r="${reference}"${attributes} t="inlineStr"><is><t${preserve}>${text}</t></is></c>`;
  }

  toXmlParts() {
    const styles = new Styles();
    const rows = [];
    for (let row = 1; row <= this.lastRow; row += 1) {
      const cells = [];
      for (let column = 1; column <= this.lastColumn; column += 1) {
        const cell = this.cells.get(`${row}:${column}`);
        if (cell) cells.push(this.cellXml(cell, styles));
      }
      const height = this.heights[row - 1];
      const heightAttr = height ? ` ht="${height}" customHeight="1"` : "";
      rows.push(`<row r="${row}"${heightAttr}>${cells.join("")}</row>`);
    }

    const cols = [];
    this.widths.forEach((value, index) => {
      if (value) {
        const column = index + 1;
        cols.push(`<col min="${column}" max="${column}" width="${value}" customWidth="1"/>`);
      }
    });

    const pane = this.freeze
      ? `<pane xSplit="${this.freeze.column - 1}" ySplit="${
          this.freeze.row - 1
        }" topLeftCell="${columnLetter(this.freeze.column)}${this.freeze.row}" activePane="bottomRight" state="frozen"/>`
      : "";

    const sheetXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<dimension ref="A1:${columnLetter(this.lastColumn)}${this.lastRow}"/>` +
      `<sheetViews><sheetView tabSelected="1" workbookViewId="0">${pane}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (cols.length ? `<cols>${cols.join("")}</cols>` : "") +
      `<sheetData>${rows.join("")}</sheetData>` +
      "</worksheet>";

    return [
      {
        name: "[Content_Types].xml",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          "</Types>",
      },
      {
        name: "_rels/.rels",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      },
      {
        name: "xl/workbook.xml",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets><sheet name="${escapeXml(this.name)}" sheetId="1" r:id="rId1"/></sheets>` +
          "</workbook>",
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          "</Relationships>",
      },
      { name: "xl/styles.xml", data: styles.toXml() },
      { name: "xl/worksheets/sheet1.xml", data: sheetXml },
    ];
  }

  toBlob() {
    return zipParts(this.toXmlParts());
  }
}

export { BORDER_HOLIDAY, BORDER_THIN };
