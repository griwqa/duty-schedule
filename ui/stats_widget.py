from PySide6.QtWidgets import (
    QTableWidget,
    QTableWidgetItem,
    QHeaderView,
    QLabel,
    QVBoxLayout,
    QWidget,
    QAbstractScrollArea,
    QSizePolicy,
)
from PySide6.QtGui import QColor, QBrush, QFont
from PySide6.QtCore import Qt

ROW_HEIGHT = 28


class StatsWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Fixed)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(6)

        self.title = QLabel("Статистика за месяц")
        self.title.setFont(QFont("Segoe UI", 12, QFont.Bold))
        layout.addWidget(self.title)

        self.table = QTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels(
            [
                "Инженер",
                "Ночных",
                "Суточных",
                "Праздничных",
                "5-дн.",
                "Часов",
                "Переработка",
            ]
        )
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(ROW_HEIGHT)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.table.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.table.setSizeAdjustPolicy(QAbstractScrollArea.AdjustToContents)
        self.table.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        layout.addWidget(self.table)

        self.summary = QLabel("")
        self.summary.setFont(QFont("Segoe UI", 10))
        self.summary.setTextFormat(Qt.RichText)
        layout.addWidget(self.summary)

    def _fit_table(self):
        for r in range(self.table.rowCount()):
            self.table.setRowHeight(r, ROW_HEIGHT)

        height = self.table.horizontalHeader().height()
        for r in range(self.table.rowCount()):
            height += self.table.rowHeight(r)
        height += 2 * self.table.frameWidth() + 2
        self.table.setFixedHeight(height)

    def update_stats(self, engineers, norm_hours: float):
        self.table.setRowCount(len(engineers))
        total = 0.0

        font_bold = QFont()
        font_bold.setBold(True)

        for r, eng in enumerate(engineers):
            self.table.setItem(r, 0, QTableWidgetItem(eng.name))
            self.table.setItem(r, 1, QTableWidgetItem(str(eng.night_count)))
            self.table.setItem(r, 2, QTableWidgetItem(str(eng.daily_count)))
            self.table.setItem(r, 3, QTableWidgetItem(str(eng.holiday_count)))
            self.table.setItem(
                r, 4, QTableWidgetItem(str(eng.five_day_count))
            )

            hours_item = QTableWidgetItem(f"{eng.total_hours:.0f}")
            hours_item.setFont(font_bold)

            overtime = eng.total_hours - norm_hours
            if abs(overtime) <= 2:
                hours_item.setBackground(QBrush(QColor("#C6EFCE")))
            elif overtime > 2:
                hours_item.setBackground(QBrush(QColor("#FFC7CE")))
            else:
                hours_item.setBackground(QBrush(QColor("#FFEB9C")))

            self.table.setItem(r, 5, hours_item)

            ot_item = QTableWidgetItem(f"{overtime:+.0f}")
            ot_item.setFont(font_bold)
            ot_item.setTextAlignment(Qt.AlignCenter)
            if overtime > 2:
                ot_item.setBackground(QBrush(QColor("#FFC7CE")))
            elif overtime < -2:
                ot_item.setBackground(QBrush(QColor("#FFEB9C")))
            else:
                ot_item.setBackground(QBrush(QColor("#C6EFCE")))
            self.table.setItem(r, 6, ot_item)

            total += eng.total_hours

        self.summary.setText(
            f"Норма месяца: <b>{norm_hours:.0f} ч</b>   |   "
            f"Итого: <b>{total:.0f} ч</b>   |   "
            f"Отклонение от нормы: "
            f"<b>{total - norm_hours * len(engineers):+.0f} ч</b>"
        )
        self._fit_table()
