import calendar as cal
from datetime import date
from functools import partial

from PySide6.QtWidgets import (
    QTableWidget,
    QTableWidgetItem,
    QHeaderView,
    QAbstractScrollArea,
    QSizePolicy,
    QAbstractItemView,
    QMenu,
)
from PySide6.QtGui import QColor, QBrush, QFont
from PySide6.QtCore import Qt, Signal, QMimeData

from core.models import (
    ROLE_EXTRA,
    ROLE_FIVE_DAY,
    ShiftType,
)
from core.engineers_store import ROLE_TITLES
from core.production_calendar import ProductionCalendar

COLOR_NIGHT = QColor("#4472C4")
COLOR_DAILY = QColor("#ED7D31")
COLOR_HOLIDAY = QColor("#C00000")
COLOR_OFF = QColor("#FFFFFF")
COLOR_WEEKEND = QColor("#FFF2CC")
COLOR_MORNING = QColor("#70AD47")
COLOR_DAY = QColor("#FFC000")
COLOR_EVENING = QColor("#7030A0")
COLOR_OFFICE = QColor("#DEEBF7")
COLOR_REMOTE = QColor("#E2EFDA")
COLOR_TRIP = QColor("#FCE4D6")
COLOR_ISSUE = QColor("#F4B6B6")
COLOR_NAME = QColor("#D9E1F2")
COLOR_NAME_FIVE = QColor("#E2EFDA")
COLOR_NAME_EXTRA = QColor("#E4DFEC")

DOW_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
ROW_HEIGHT = 28
NAME_WIDTH = 160
DAY_WIDTH = 42
MIN_DAY_WIDTH = 38

SHIFT_MIME = "application/x-shift-cell"


class ScheduleWidget(QTableWidget):
    engineer_clicked = Signal(int)  # клик по имени сотрудника
    schedule_edited = Signal()      # смены изменены вручную

    def __init__(self, parent=None):
        super().__init__(parent)
        self._engineer_count = 0
        self._engineers = []
        self._year = None
        self._month = None
        self._calendar = None
        self._night_hours = 15.0
        self._daily_hours = 24.0
        self._issue_days: set[int] = set()
        self._total_width = 0
        self.setEditTriggers(QTableWidget.NoEditTriggers)
        self.setSelectionMode(QTableWidget.SingleSelection)
        self.horizontalHeader().setSectionResizeMode(QHeaderView.Fixed)
        self.verticalHeader().setVisible(False)
        self.verticalHeader().setDefaultSectionSize(ROW_HEIGHT)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setSizeAdjustPolicy(QAbstractScrollArea.AdjustToContents)
        self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)

        self.setDragEnabled(True)
        self.setAcceptDrops(True)
        self.setDropIndicatorShown(True)
        self.setDragDropMode(QAbstractItemView.DragDrop)
        self.setDefaultDropAction(Qt.MoveAction)
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._show_context_menu)

        self.cellClicked.connect(self._on_cell_clicked)

    def _on_cell_clicked(self, row: int, col: int):
        if col == 0 and 0 <= row < self._engineer_count:
            self.engineer_clicked.emit(row)

    def _frame_extra(self) -> int:
        return 2 * self.frameWidth() + 2

    def min_total_width(self) -> int:
        days = max(0, self.columnCount() - 1)
        return self._frame_extra() + NAME_WIDTH + MIN_DAY_WIDTH * days

    def set_total_width(self, width: int):
        """Растянуть таблицу на заданную ширину (дни делят остаток)."""
        self._total_width = max(0, width)
        self._fit_to_contents()

    def _fit_to_contents(self):
        """Размер таблицы ровно по последней строке и последнему столбцу."""
        for r in range(self.rowCount()):
            self.setRowHeight(r, ROW_HEIGHT)

        height = self.horizontalHeader().height()
        for r in range(self.rowCount()):
            height += self.rowHeight(r)
        height += self._frame_extra()

        days = max(0, self.columnCount() - 1)
        frame = self._frame_extra()
        if days:
            if self._total_width > 0:
                available = max(
                    NAME_WIDTH + MIN_DAY_WIDTH * days,
                    self._total_width - frame,
                )
            else:
                available = NAME_WIDTH + DAY_WIDTH * days
            day_w = max(MIN_DAY_WIDTH, (available - NAME_WIDTH) // days)
            used = NAME_WIDTH + day_w * days
            remainder = max(0, available - used)
            self.setColumnWidth(0, NAME_WIDTH)
            for c in range(1, self.columnCount()):
                self.setColumnWidth(c, day_w + (1 if c <= remainder else 0))

        width = frame
        for c in range(self.columnCount()):
            width += self.columnWidth(c)

        self.setFixedSize(width, height)

    def render(
        self,
        engineers,
        year: int,
        month: int,
        prod_calendar: ProductionCalendar,
        night_hours: float = 15.0,
        daily_hours: float = 24.0,
    ):
        """Отрисовка графика."""
        self._engineers = engineers
        self._year = year
        self._month = month
        self._calendar = prod_calendar
        self._night_hours = night_hours
        self._daily_hours = daily_hours

        _, days_in_month = cal.monthrange(year, month)
        rows = len(engineers) + 1
        cols = days_in_month + 1
        self._engineer_count = len(engineers)

        self.blockSignals(True)
        self.clear()
        self.setRowCount(rows)
        self.setColumnCount(cols)
        self.setHorizontalHeaderLabels(
            [""] + [str(d) for d in range(1, days_in_month + 1)]
        )

        font_bold = QFont()
        font_bold.setBold(True)
        readonly = Qt.ItemIsEnabled | Qt.ItemIsSelectable
        draggable = readonly | Qt.ItemIsDragEnabled

        for r, eng in enumerate(engineers):
            name_item = QTableWidgetItem(eng.name)
            name_item.setTextAlignment(Qt.AlignCenter)
            name_item.setFont(font_bold)
            if eng.role == ROLE_EXTRA:
                name_item.setBackground(QBrush(COLOR_NAME_EXTRA))
            elif eng.role == ROLE_FIVE_DAY:
                name_item.setBackground(QBrush(COLOR_NAME_FIVE))
            else:
                name_item.setBackground(QBrush(COLOR_NAME))
            name_item.setFlags(readonly)
            info = ROLE_TITLES.get(eng.role, "")
            if eng.position:
                info += f" · {eng.position}"
            name_item.setToolTip(
                f"{info}\nНажмите, чтобы изменить роль и должность."
            )
            self.setItem(r, 0, name_item)

            for d in range(1, days_in_month + 1):
                shift = eng.shifts[d - 1]
                item = QTableWidgetItem(shift.value)
                item.setTextAlignment(Qt.AlignCenter)
                item.setFont(font_bold)
                item.setFlags(draggable)
                if eng.role == ROLE_EXTRA:
                    item.setToolTip(
                        "Доп. инженер: правый клик — У (утро), Д (день), "
                        "В (вечер) или выходной.\n"
                        "Перетаскивание обменивает значения между датами."
                    )
                elif eng.role == ROLE_FIVE_DAY:
                    item.setToolTip(
                        "5-дневный график: правый клик — о (офис), "
                        "у (удалёнка), в (выезд) или выходной.\n"
                        "Перетаскивание обменивает значения между датами."
                    )
                else:
                    item.setToolTip(
                        "Перетащите смену на другую дату, чтобы обменять.\n"
                        "Правый клик — выбрать тип смены, Delete — выходной."
                    )

                if shift == ShiftType.NIGHT:
                    item.setBackground(QBrush(COLOR_NIGHT))
                    item.setForeground(QBrush(QColor("#FFFFFF")))
                elif shift == ShiftType.DAILY:
                    item.setBackground(QBrush(COLOR_DAILY))
                    item.setForeground(QBrush(QColor("#FFFFFF")))
                elif shift == ShiftType.HOLIDAY:
                    item.setBackground(QBrush(COLOR_HOLIDAY))
                    item.setForeground(QBrush(QColor("#FFFFFF")))
                elif shift == ShiftType.MORNING:
                    item.setBackground(QBrush(COLOR_MORNING))
                    item.setForeground(QBrush(QColor("#FFFFFF")))
                elif shift == ShiftType.DAY:
                    item.setBackground(QBrush(COLOR_DAY))
                elif shift == ShiftType.EVENING:
                    item.setBackground(QBrush(COLOR_EVENING))
                    item.setForeground(QBrush(QColor("#FFFFFF")))
                elif shift == ShiftType.OFFICE:
                    item.setBackground(QBrush(COLOR_OFFICE))
                elif shift == ShiftType.REMOTE:
                    item.setBackground(QBrush(COLOR_REMOTE))
                elif shift == ShiftType.TRIP:
                    item.setBackground(QBrush(COLOR_TRIP))
                else:
                    dt = date(year, month, d)
                    if prod_calendar.is_weekend(dt):
                        item.setBackground(QBrush(COLOR_WEEKEND))
                    else:
                        item.setBackground(QBrush(COLOR_OFF))

                self.setItem(r, d, item)

        dow_row = len(engineers)
        dow_item = QTableWidgetItem("Д.Н.")
        dow_item.setTextAlignment(Qt.AlignCenter)
        dow_item.setFont(font_bold)
        dow_item.setBackground(QBrush(COLOR_NAME))
        dow_item.setFlags(readonly)
        self.setItem(dow_row, 0, dow_item)

        for d in range(1, days_in_month + 1):
            dt = date(year, month, d)
            item = QTableWidgetItem(DOW_RU[dt.weekday()])
            item.setTextAlignment(Qt.AlignCenter)
            item.setFont(font_bold)
            item.setFlags(readonly)
            if prod_calendar.is_holiday(dt):
                item.setBackground(QBrush(COLOR_HOLIDAY))
                item.setForeground(QBrush(QColor("#FFFFFF")))
                item.setToolTip("Праздничный день")
            elif prod_calendar.is_weekend(dt):
                item.setBackground(QBrush(COLOR_WEEKEND))
            self.setItem(dow_row, d, item)

        self.blockSignals(False)
        self._fit_to_contents()
        self.mark_issue_days(self._issue_days)

    def mark_issue_days(self, days: set[int]):
        """Подсветить дни с нарушением покрытия/соседних смен (1-based)."""
        self._issue_days = set(days)
        for col in range(1, self.columnCount()):
            item = self.horizontalHeaderItem(col)
            if item is None:
                continue
            if col in self._issue_days:
                item.setBackground(QBrush(COLOR_ISSUE))
                item.setToolTip("Проверьте покрытие дня или смены подряд")
            else:
                item.setBackground(QBrush(QColor(0, 0, 0, 0)))
                item.setToolTip("")

    # ---------- Перетаскивание смен ----------

    def mimeData(self, items):
        mime = QMimeData()
        if items:
            item = items[0]
            row, col = item.row(), item.column()
            if 0 <= row < self._engineer_count and col >= 1:
                mime.setData(SHIFT_MIME, f"{row},{col}".encode())
        return mime

    def dragEnterEvent(self, event):
        if event.mimeData().hasFormat(SHIFT_MIME):
            event.setDropAction(Qt.MoveAction)
            event.accept()
        else:
            event.ignore()

    def dragMoveEvent(self, event):
        if event.mimeData().hasFormat(SHIFT_MIME):
            event.setDropAction(Qt.MoveAction)
            event.accept()
        else:
            event.ignore()

    def dropEvent(self, event):
        if not event.mimeData().hasFormat(SHIFT_MIME):
            event.ignore()
            return
        try:
            raw = bytes(event.mimeData().data(SHIFT_MIME)).decode()
            row_s, col_s = (int(part) for part in raw.split(","))
        except (ValueError, UnicodeDecodeError):
            event.ignore()
            return

        index = self.indexAt(event.position().toPoint())
        if not index.isValid():
            event.ignore()
            return
        row_t, col_t = index.row(), index.column()
        if not (0 <= row_s < self._engineer_count):
            event.ignore()
            return
        if not (0 <= row_t < self._engineer_count and col_t >= 1):
            event.ignore()
            return
        if (row_s, col_s) == (row_t, col_t):
            event.ignore()
            return
        # Нельзя смешивать сотрудников разных ролей
        if (
            self._engineers[row_s].role
            != self._engineers[row_t].role
        ):
            event.ignore()
            return

        self.swap_cells(row_s, col_s, row_t, col_t)
        event.setDropAction(Qt.MoveAction)
        event.accept()

    def swap_cells(self, row_a: int, col_a: int, row_b: int, col_b: int):
        """Обменять содержимое двух ячеек графика (сменами)."""
        if not self._engineers:
            return
        if not (
            0 <= row_a < self._engineer_count
            and 0 <= row_b < self._engineer_count
        ):
            return
        if col_a < 1 or col_b < 1:
            return
        eng_a, eng_b = self._engineers[row_a], self._engineers[row_b]
        if eng_a.role != eng_b.role:
            return
        i_a, i_b = col_a - 1, col_b - 1
        shift_a, shift_b = eng_a.shifts[i_a], eng_b.shifts[i_b]
        if shift_a == shift_b:
            return
        eng_a.shifts[i_a], eng_b.shifts[i_b] = shift_b, shift_a
        self._render_current()
        self.schedule_edited.emit()

    def _render_current(self):
        self.render(
            self._engineers,
            self._year,
            self._month,
            self._calendar,
            self._night_hours,
            self._daily_hours,
        )

    # ---------- Правка смен ----------

    def _show_context_menu(self, pos):
        index = self.indexAt(pos)
        if not index.isValid():
            return
        row, col = index.row(), index.column()
        if col < 1 or row >= self._engineer_count:
            return

        menu = QMenu(self)
        role = self._engineers[row].role
        if role == ROLE_EXTRA:
            options = (
                ("Утро (У)", ShiftType.MORNING),
                ("День (Д)", ShiftType.DAY),
                ("Вечер (В)", ShiftType.EVENING),
                ("Выходной (—)", ShiftType.OFF),
            )
        elif role == ROLE_FIVE_DAY:
            options = (
                ("Офис (о)", ShiftType.OFFICE),
                ("Удалёнка (у)", ShiftType.REMOTE),
                ("Выезд (в)", ShiftType.TRIP),
                ("Выходной (—)", ShiftType.OFF),
            )
        else:
            options = (
                ("Суточная (С)", ShiftType.DAILY),
                ("Праздничная (П)", ShiftType.HOLIDAY),
                ("Ночная (Н)", ShiftType.NIGHT),
                ("Выходной (—)", ShiftType.OFF),
            )
        for text, shift in options:
            action = menu.addAction(text)
            action.triggered.connect(partial(self._set_shift, row, col, shift))
        menu.exec(self.viewport().mapToGlobal(pos))

    def _set_shift(self, row: int, col: int, shift: ShiftType):
        if not self._engineers or row >= self._engineer_count:
            return
        self._engineers[row].shifts[col - 1] = shift
        self._render_current()
        self.schedule_edited.emit()

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Delete, Qt.Key_Backspace):
            row, col = self.currentRow(), self.currentColumn()
            if 0 <= row < self._engineer_count and col >= 1:
                self._set_shift(row, col, ShiftType.OFF)
                event.accept()
                return
        super().keyPressEvent(event)
