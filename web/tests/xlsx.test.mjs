// Проверка писателя .xlsx: файл обязан быть настоящим OOXML-архивом, а не
// HTML-таблицей с расширением Excel. Запуск: node web/tests/xlsx.test.mjs

import assert from "node:assert/strict";
import { Sheet, BORDER_HOLIDAY, BORDER_THIN } from "../xlsx.js";

function buildSheet() {
  const sheet = new Sheet("График");
  const head = { fill: "#305496", color: "#FFFFFF", bold: true, border: BORDER_THIN };
  sheet.freezeAt(3, 2);
  sheet.width(1, 18).width(2, 16).width(3, 4.5);
  sheet.height(1, 18);
  sheet.set(1, 1, "Инженер", head);
  sheet.set(1, 2, 'Телефон & "должность" <пр>', head);
  sheet.set(1, 3, 1, head);
  sheet.set(2, 1, "Инженер A", { fill: "#D9E1F2", bold: true, border: BORDER_THIN });
  sheet.set(2, 2, "+7 (900) 123-45-67", { border: BORDER_THIN, align: "left" });
  sheet.set(2, 3, "С", { fill: "#ED7D31", color: "#FFFFFF", bold: true, border: BORDER_HOLIDAY });
  sheet.set(3, 3, 24, { border: BORDER_THIN });
  sheet.set(3, 2, "", { fill: "#FFF2CC", border: BORDER_THIN });
  return sheet;
}

const latin1Table = Array.from({ length: 256 }, (_, index) => String.fromCharCode(index));
const Utf8 = {
  decode(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  },
};
const Latin1 = {
  decode(bytes) {
    let text = "";
    for (const byte of bytes) text += latin1Table[byte];
    return text;
  },
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function checksum(bytes, from, to) {
  let crc = 0xffffffff;
  for (let index = from; index < to; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function localEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && readU32(bytes, offset) === 0x04034b50) {
    const method = readU16(bytes, offset + 8);
    const crc = readU32(bytes, offset + 14);
    const size = readU32(bytes, offset + 18);
    const nameLength = readU16(bytes, offset + 26);
    const extraLength = readU16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      name: Latin1.decode(bytes.slice(nameStart, nameStart + nameLength)),
      method,
      crc,
      data: bytes.slice(dataStart, dataStart + size),
    });
    offset = dataStart + size;
  }
  return { entries, endOfEntries: offset };
}

const sheet = buildSheet();
const blob = await sheet.toBlob();
const bytes = new Uint8Array(await blob.arrayBuffer());
const content = Latin1.decode(bytes);

assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
assert.equal(readU32(bytes, 0), 0x04034b50, "сигнатура ZIP");
assert.equal(content.includes("PK\u0005\u0006"), true, "центральный каталог ZIP");
assert.equal(content.includes("<html"), false, "внутри нет HTML");

const names = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/styles.xml",
  "xl/worksheets/sheet1.xml",
];
for (const name of names) {
  assert.equal(content.includes(name), true, `часть ${name} в архиве`);
}

const { entries } = localEntries(bytes);
assert.equal(entries.length, names.length, "шесть частей");
for (const entry of entries) {
  assert.equal(entry.method, 0, `${entry.name}: метод store`);
  assert.equal(entry.crc, checksum(entry.data, 0, entry.data.length), `${entry.name}: CRC32`);
}

const sheetXml = Utf8.decode(entries.find((entry) => entry.name === "xl/worksheets/sheet1.xml").data);
const stylesXml = Utf8.decode(entries.find((entry) => entry.name === "xl/styles.xml").data);

assert.match(sheetXml, /<pane xSplit="2" ySplit="1" topLeftCell="C2"[^>]*state="frozen"\/>/);
assert.match(sheetXml, /<dimension ref="A1:C3"\/>/);
assert.match(sheetXml, /<col min="1" max="1" width="18" customWidth="1"\/>/);
assert.match(sheetXml, /<row r="1" ht="18" customHeight="1">/);
assert.match(sheetXml, /<c r="B1"[^>]*t="inlineStr"><is><t>Телефон &amp; &quot;должность&quot; &lt;пр&gt;<\/t><\/is><\/c>/);
assert.match(sheetXml, /<c r="B2"[^>]*><is><t>\+7 \(900\) 123-45-67<\/t><\/is><\/c>/, "телефон — текст");
assert.match(sheetXml, /<c r="C3"[^>]*><v>24<\/v><\/c>/, "часы — число");
assert.match(sheetXml, /<c r="B3" s="\d+"\/>/, "пустая ячейка сохранена со стилем");

assert.match(stylesXml, /<patternFill patternType="solid"><fgColor rgb="FF305496"\/>/);
assert.match(stylesXml, /<border><left style="medium"><color rgb="FFC00000"\/><\/left>/);
assert.match(stylesXml, /<font><b\/><color rgb="FFFFFFFF"\/>/);
assert.match(stylesXml, /<alignment horizontal="left" vertical="center"\/>/);

// Одинаковые стили не должны размножать cellXfs.
const repeated = new Sheet("Повтор");
const style = { fill: "#ED7D31", color: "#FFFFFF", bold: true, border: BORDER_THIN };
for (let row = 1; row <= 30; row += 1) {
  for (let column = 1; column <= 30; column += 1) repeated.set(row, column, "С", style);
}
const repeatedStyles = repeated.toXmlParts().find((part) => part.name === "xl/styles.xml").data;
assert.match(repeatedStyles, /<cellXfs count="2">/);
assert.match(repeatedStyles, /<fills count="3">/);

console.log("xlsx.test: ok,", bytes.length, "байт");
