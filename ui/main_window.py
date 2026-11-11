from datetime import date
from pathlib import Path

from PySide6.QtWidgets import (
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton,
    QComboBox,
    QLabel,
    QLineEdit,
    QFileDialog,
    QMessageBox,
    QSpinBox,
    QCheckBox,
    QDialog,
    QFormLayout,
    QDialogButtonBox,
    QDoubleSpinBox,
    QSizePolicy,
    QDateEdit,
)
from PySide6.QtCore import QDate, Qt

from ui.schedule_widget import ScheduleWidget
from ui.stats_widget import StatsWidget
from core.models import ROLE_DUTY, ROLE_EXTRA, ROLE_FIVE_DAY
from core.production_calendar import ProductionCalendar
from core.schedule_generator import generate_linked
from core.engineers_store import (
    StaffMember,
    ROLE_TITLES,
    count_role,
    ensure_role_count,
    load_staff,
    save_staff,
)
from core.rotation import (
    generate_rotation,
    make_extra_engineers,
    make_five_day_engineers,
    validate_schedule,
)
from core.settings_store import load_settings, save_settings

MONTHS_RU = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]


class SettingsDialog(QDialog):
    def __init__(
        self,
        night_hours: float,
        daily_hours: float,
        workday_hours: float,
        parent=None,
    ):
        super().__init__(parent)
        self.setWindowTitle("Настройки смен")
        self.setModal(True)

        layout = QFormLayout(self)

        self.sp_night = QDoubleSpinBox()
        self.sp_night.setRange(1, 24)
        self.sp_night.setValue(night_hours)
        self.sp_night.setSuffix(" ч")
        layout.addRow("Ночная смена:", self.sp_night)

        self.sp_daily = QDoubleSpinBox()
        self.sp_daily.setRange(1, 24)
        self.sp_daily.setValue(daily_hours)
        self.sp_daily.setSuffix(" ч")
        layout.addRow("Суточная смена:", self.sp_daily)

        self.sp_workday = QDoubleSpinBox()
        self.sp_workday.setRange(1, 12)
        self.sp_workday.setValue(workday_hours)
        self.sp_workday.setSuffix(" ч")
        layout.addRow("Рабочий день (5-дневка):", self.sp_workday)

        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addRow(buttons)

    @property
    def night_hours(self) -> float:
        return self.sp_night.value()

    @property
    def daily_hours(self) -> float:
        return self.sp_daily.value()

    @property
    def workday_hours(self) -> float:
        return self.sp_workday.value()


class EngineerDialog(QDialog):
    """Карточка сотрудника: имя, роль в отделе, должность."""

    def __init__(self, member: StaffMember | None = None, parent=None):
        super().__init__(parent)
        self.setWindowTitle(
            "Сотрудник отдела" if member is not None else "Новый сотрудник"
        )
        self.setModal(True)
        self.setMinimumWidth(460)
        self.deleted = False

        layout = QFormLayout(self)

        self.ed_name = QLineEdit(member.name if member else "")
        self.ed_name.setMinimumWidth(320)
        layout.addRow("Имя:", self.ed_name)

        self.cb_role = QComboBox()
        for role in (ROLE_DUTY, ROLE_FIVE_DAY, ROLE_EXTRA):
            self.cb_role.addItem(ROLE_TITLES[role], role)
        if member is not None:
            index = self.cb_role.findData(member.role)
            if index >= 0:
                self.cb_role.setCurrentIndex(index)
        layout.addRow("Роль:", self.cb_role)

        self.ed_position = QLineEdit(member.position if member else "")
        self.ed_position.setPlaceholderText("например, ведущий инженер")
        layout.addRow("Должность:", self.ed_position)

        hint = QLabel(
            "5-дневный график заполняется автоматически по будням "
            "(офис); тип дня — о / у / в — меняется правым кликом по ячейке."
        )
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #6B7280; font-size: 11px;")
        layout.addRow(hint)

        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel
        )
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        if member is not None:
            btn_delete = buttons.addButton(
                "Удалить", QDialogButtonBox.DestructiveRole
            )
            btn_delete.clicked.connect(self._on_delete)
        layout.addRow(buttons)

    def _on_accept(self):
        if not self.ed_name.text().strip():
            QMessageBox.warning(self, "Имя", "Укажите имя сотрудника.")
            return
        self.accept()

    def _on_delete(self):
        self.deleted = True
        self.accept()

    @property
    def name(self) -> str:
        return self.ed_name.text().strip()

    @property
    def role(self) -> str:
        return self.cb_role.currentData()

    @property
    def position(self) -> str:
        return self.ed_position.text().strip()


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("График дежурств инженеров")
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Preferred)

        self.prod_calendar = ProductionCalendar()
        self.engineers_data = []
        self.staff = load_staff()
        self._rows: list[StaffMember] = []
        self.settings = load_settings()
        self.norm_hours = 176.0
        self.night_hours = 15.0
        self.daily_hours = 24.0
        self.workday_hours = 8.0
        self._dirty = False
        self._last_state: dict | None = None

        self._build_ui()
        self._apply_settings()
        self._load_default_calendar()
        self.generate_schedule()

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)

        toolbar = QHBoxLayout()

        btn_cal = QPushButton("Загрузить производственный календарь")
        btn_cal.clicked.connect(self.load_calendar)
        toolbar.addWidget(btn_cal)

        btn_settings = QPushButton("Настройки смен")
        btn_settings.clicked.connect(self.open_settings)
        toolbar.addWidget(btn_settings)

        btn_gen = QPushButton("Сформировать график")
        btn_gen.clicked.connect(self.generate_schedule)
        toolbar.addWidget(btn_gen)

        btn_excel = QPushButton("Экспорт в Excel")
        btn_excel.clicked.connect(self.export_excel)
        toolbar.addWidget(btn_excel)

        toolbar.addStretch()
        main_layout.addLayout(toolbar)
        self._toolbar_layout = toolbar

        params = QHBoxLayout()

        params.addWidget(QLabel("Месяц:"))
        self.cb_month = QComboBox()
        self.cb_month.addItems(MONTHS_RU)
        self.cb_month.setCurrentIndex(date.today().month - 1)
        self.cb_month.currentIndexChanged.connect(self._on_period_changed)
        params.addWidget(self.cb_month)

        params.addWidget(QLabel("Год:"))
        self.sp_year = QSpinBox()
        self.sp_year.setRange(2020, 2100)
        self.sp_year.setValue(date.today().year)
        self.sp_year.valueChanged.connect(self._on_period_changed)
        params.addWidget(self.sp_year)

        params.addWidget(QLabel("Суточников:"))
        self.sp_count = QSpinBox()
        self.sp_count.setRange(2, 20)
        self.sp_count.setValue(
            max(2, count_role(self.staff, ROLE_DUTY))
        )
        params.addWidget(self.sp_count)

        params.addWidget(QLabel("Доп. инженеров:"))
        self.sp_extra = QSpinBox()
        self.sp_extra.setRange(0, 20)
        self.sp_extra.setValue(count_role(self.staff, ROLE_EXTRA))
        params.addWidget(self.sp_extra)

        params.addWidget(QLabel("График:"))
        self.cb_mode = QComboBox()
        self.cb_mode.addItem("1/3 — сутки через трое", "rotation")
        self.cb_mode.addItem(
            "Н/С — ночь в будни, сутки в выходные", "night_weekend"
        )
        self.cb_mode.currentIndexChanged.connect(self._on_settings_changed)
        params.addWidget(self.cb_mode)

        self.lbl_anchor = QLabel("Начало цикла:")
        params.addWidget(self.lbl_anchor)
        self.de_anchor = QDateEdit()
        self.de_anchor.setCalendarPopup(True)
        self.de_anchor.setDisplayFormat("dd.MM.yyyy")
        self.de_anchor.setDateRange(QDate(2020, 1, 1), QDate(2100, 12, 31))
        self.de_anchor.dateChanged.connect(self._on_settings_changed)
        params.addWidget(self.de_anchor)

        self.chk_holidays = QCheckBox("Учитывать праздники")
        self.chk_holidays.setChecked(True)
        params.addWidget(self.chk_holidays)

        self.chk_sum = QCheckBox("Суммированный учёт")
        self.chk_sum.setChecked(True)
        params.addWidget(self.chk_sum)

        params.addStretch()
        main_layout.addLayout(params)
        self._params_layout = params

        self.lbl_conditions = QLabel(
            "Условия работы:  "
            "Н — ночная смена 19:00–10:00 (15 ч)  ·  "
            "С / П — суточная смена 10:00–10:00 (24 ч)  ·  "
            "перерыв на обед 1 ч  ·  "
            "ночной перерыв — от 30 мин до 2 ч (ст. 108 ТК РФ; обычно до 2 ч)"
        )
        self.lbl_conditions.setWordWrap(True)
        self.lbl_conditions.setStyleSheet(
            "color: #374151; font-size: 12px; padding: 4px 2px 6px 2px;"
        )
        main_layout.addWidget(self.lbl_conditions)

        self.schedule_widget = ScheduleWidget()
        self.schedule_widget.engineer_clicked.connect(self._on_engineer_clicked)
        self.schedule_widget.schedule_edited.connect(self._on_schedule_edited)
        main_layout.addWidget(self.schedule_widget, stretch=0)

        schedule_actions = QHBoxLayout()
        btn_add = QPushButton("+ Добавить инженера")
        btn_add.clicked.connect(self.add_engineer)
        schedule_actions.addWidget(btn_add)
        self.lbl_staff_hint = QLabel(
            "Клик по имени сотрудника — роль, должность и удаление."
        )
        self.lbl_staff_hint.setStyleSheet("color: #6B7280; font-size: 11px;")
        schedule_actions.addWidget(self.lbl_staff_hint)
        schedule_actions.addStretch()
        main_layout.addLayout(schedule_actions)

        self.lbl_validation = QLabel("")
        self.lbl_validation.setWordWrap(True)
        main_layout.addWidget(self.lbl_validation)

        self.stats_widget = StatsWidget()
        main_layout.addWidget(self.stats_widget, stretch=0)

        self.sp_count.valueChanged.connect(self._on_count_changed)
        self.sp_extra.valueChanged.connect(self._on_extra_count_changed)

    def _on_period_changed(self):
        self.generate_schedule()

    def _on_count_changed(self):
        self.generate_schedule()

    def _on_extra_count_changed(self):
        self.generate_schedule()

    def _stats_engineers(self):
        return [
            eng for eng in self.engineers_data if eng.role != ROLE_EXTRA
        ]

    def _sync_counts(self):
        """Показать в счётчиках фактическое число сотрудников по ролям."""
        for widget, role in (
            (self.sp_count, ROLE_DUTY),
            (self.sp_extra, ROLE_EXTRA),
        ):
            widget.blockSignals(True)
            widget.setValue(count_role(self.staff, role))
            widget.blockSignals(False)

    def add_engineer(self):
        if not self._confirm_discard_edits():
            return
        dlg = EngineerDialog(None, self)
        if dlg.exec() != QDialog.Accepted:
            return
        if dlg.role == ROLE_DUTY and (
            count_role(self.staff, ROLE_DUTY) >= self.sp_count.maximum()
        ):
            QMessageBox.warning(
                self, "Лимит", "Слишком много суточников в графике."
            )
            return
        if dlg.role == ROLE_EXTRA and (
            count_role(self.staff, ROLE_EXTRA) >= self.sp_extra.maximum()
        ):
            QMessageBox.warning(
                self, "Лимит", "Слишком много доп. инженеров."
            )
            return
        self.staff.append(
            StaffMember(name=dlg.name, role=dlg.role, position=dlg.position)
        )
        self._apply_staff_changes()

    def _on_engineer_clicked(self, index: int):
        if not (0 <= index < len(self._rows)):
            return
        member = self._rows[index]
        if not self._confirm_discard_edits():
            return
        dlg = EngineerDialog(member, self)
        if dlg.exec() != QDialog.Accepted:
            return

        duty_count = count_role(self.staff, ROLE_DUTY)
        extra_count = count_role(self.staff, ROLE_EXTRA)
        if dlg.deleted:
            if member.role == ROLE_DUTY and duty_count <= 2:
                QMessageBox.warning(
                    self,
                    "Удаление",
                    "В ротации должно остаться минимум 2 суточника.",
                )
                return
            self.staff = [m for m in self.staff if m is not member]
        else:
            duty_after = (
                duty_count
                - (1 if member.role == ROLE_DUTY else 0)
                + (1 if dlg.role == ROLE_DUTY else 0)
            )
            if duty_after < 2:
                QMessageBox.warning(
                    self,
                    "Роль",
                    "В ротации должно остаться минимум 2 суточника.",
                )
                return
            extra_after = (
                extra_count
                - (1 if member.role == ROLE_EXTRA else 0)
                + (1 if dlg.role == ROLE_EXTRA else 0)
            )
            if (
                duty_after > self.sp_count.maximum()
                or extra_after > self.sp_extra.maximum()
            ):
                QMessageBox.warning(
                    self, "Лимит", "Слишком много сотрудников этой роли."
                )
                return
            member.name = dlg.name
            member.role = dlg.role
            member.position = dlg.position
        self._apply_staff_changes()

    def _apply_staff_changes(self):
        self._dirty = False
        self._sync_counts()
        save_staff(self.staff)
        self.generate_schedule()

    def _on_settings_changed(self):
        self._update_mode_text()
        self._update_anchor_visibility()
        self.generate_schedule()

    def _apply_settings(self):
        self.cb_mode.blockSignals(True)
        self.de_anchor.blockSignals(True)
        index = self.cb_mode.findData(self.settings.get("mode"))
        if index >= 0:
            self.cb_mode.setCurrentIndex(index)
        self.de_anchor.setDate(
            QDate.fromString(self.settings.get("anchor", ""), Qt.ISODate)
        )
        self.cb_mode.blockSignals(False)
        self.de_anchor.blockSignals(False)
        self._update_mode_text()
        self._update_anchor_visibility()

    def _save_settings(self):
        self.settings = {
            "mode": self.cb_mode.currentData(),
            "anchor": self.de_anchor.date().toString(Qt.ISODate),
        }
        save_settings(self.settings)

    def _update_mode_text(self):
        count = self.sp_count.value()
        if count == 4:
            text = "1/3 — сутки через трое"
        else:
            text = f"1/{count - 1} — ротация смен"
        self.cb_mode.setItemText(0, text)

    def _update_anchor_visibility(self):
        is_rotation = self.cb_mode.currentData() == "rotation"
        self.lbl_anchor.setVisible(is_rotation)
        self.de_anchor.setVisible(is_rotation)

    def _on_schedule_edited(self):
        if not self.engineers_data:
            return
        for eng in self.engineers_data:
            eng.recalculate(
                self.night_hours, self.daily_hours, self.workday_hours
            )
        self.stats_widget.update_stats(
            self._stats_engineers(), self.norm_hours
        )
        self._dirty = True
        self._update_validation()

    def _update_validation(self):
        if not self.engineers_data:
            self.lbl_validation.setText("")
            return
        issues, issue_days = validate_schedule(self.engineers_data)
        self.schedule_widget.mark_issue_days(issue_days)
        days = len(self.engineers_data[0].shifts)
        if not issues:
            self.lbl_validation.setText(
                f"Покрытие: все {days} дн. — на смене ровно один инженер, "
                "смен подряд нет."
            )
            self.lbl_validation.setStyleSheet(
                "color: #166534; font-size: 12px; padding: 2px;"
            )
        else:
            preview = "; ".join(issues[:4])
            rest = len(issues) - 4
            if rest > 0:
                preview += f" и ещё {rest}"
            self.lbl_validation.setText(f"Замечания: {preview}")
            self.lbl_validation.setStyleSheet(
                "color: #991B1B; font-size: 12px; padding: 2px;"
            )

    def _update_conditions_label(self, mode: str):
        extras = (
            " 5-дневные сотрудники: о — офис, у — удалёнка, в — выезд. "
            "Доп. инженеры перекрывают часть суток: У — утро, Д — день, "
            "В — вечер. Праздники выделены красным в строке Д.Н. "
            "Клик по имени — роль и должность."
        )
        if mode == "rotation":
            anchor = self.de_anchor.date().toString("dd.MM.yyyy")
            rest = self.sp_count.value() - 1
            self.lbl_conditions.setText(
                "Условия работы: смена 24 ч (С, 10:00–10:00), ежедневно "
                "на смене один инженер. "
                f"Ротация от {anchor}: 1 смена / {rest} дн. отдыха. "
                "Праздничная смена — П. Перетащите смену на другую дату, "
                "чтобы обменять; правый клик — смена типа." + extras
            )
        else:
            self.lbl_conditions.setText(
                "Условия работы:  Н — ночная смена 19:00–10:00 (15 ч)  ·  "
                "С / П — суточная смена 10:00–10:00 (24 ч)  ·  "
                "перерыв на обед 1 ч  ·  "
                "ночной перерыв — от 30 мин до 2 ч (ст. 108 ТК РФ; обычно до 2 ч)."
                + extras
            )

    def _calendars_for_chain(self, year: int) -> dict[int, ProductionCalendar]:
        """Календари текущего и соседних лет — для стыка декабря и января."""
        calendars: dict[int, ProductionCalendar] = {year: self.prod_calendar}
        for y in (year - 1, year + 1):
            path = self._calendar_path_for_year(y)
            if path is None:
                continue
            cal = ProductionCalendar()
            cal.load_from_json(str(path))
            calendars[y] = cal
        return calendars

    def _calendar_path_for_year(self, year: int) -> Path | None:
        path = Path(__file__).resolve().parent.parent / "data" / f"calendar_{year}.json"
        return path if path.exists() else None

    def _load_default_calendar(self):
        """Загрузить производственный календарь года или только выходные."""
        year = self.sp_year.value()
        path = self._calendar_path_for_year(year)
        if path is not None:
            self.prod_calendar = ProductionCalendar()
            self.prod_calendar.load_from_json(str(path))
            return
        month = self.cb_month.currentIndex() + 1
        self.prod_calendar.fill_month_weekends(year, month)

    def load_calendar(self):
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Выберите производственный календарь",
            "data",
            "JSON files (*.json);;All files (*)",
        )
        if not path:
            return
        try:
            self.prod_calendar.load_from_json(path)
            QMessageBox.information(self, "Успех", "Календарь загружен!")
            self.generate_schedule()
        except Exception as e:
            QMessageBox.critical(self, "Ошибка", f"Не удалось загрузить:\n{e}")

    def open_settings(self):
        dlg = SettingsDialog(
            self.night_hours, self.daily_hours, self.workday_hours, self
        )
        if dlg.exec() == QDialog.Accepted:
            self.night_hours = dlg.night_hours
            self.daily_hours = dlg.daily_hours
            self.workday_hours = dlg.workday_hours
            self.generate_schedule()

    def _confirm_discard_edits(self) -> bool:
        if not self._dirty:
            return True
        answer = QMessageBox.question(
            self,
            "Ручные правки",
            "График изменён вручную. Пересоздать его?\n"
            "Ручные правки будут потеряны.",
        )
        return answer == QMessageBox.StandardButton.Yes

    def _restore_last_state(self):
        """Вернуть переключатели к последнему сгенерированному графику."""
        state = self._last_state
        if not state:
            return
        widgets = (
            self.cb_mode,
            self.de_anchor,
            self.sp_count,
            self.sp_extra,
            self.cb_month,
            self.sp_year,
        )
        for wdg in widgets:
            wdg.blockSignals(True)
        index = self.cb_mode.findData(state["mode"])
        if index >= 0:
            self.cb_mode.setCurrentIndex(index)
        self.de_anchor.setDate(
            QDate.fromString(state["anchor"], Qt.ISODate)
        )
        self.sp_count.setValue(state["count"])
        self.sp_extra.setValue(state["extra_count"])
        self.cb_month.setCurrentIndex(state["month"] - 1)
        self.sp_year.setValue(state["year"])
        for wdg in widgets:
            wdg.blockSignals(False)
        self._update_mode_text()
        self._update_anchor_visibility()
        self._load_default_calendar()

    def generate_schedule(self) -> bool:
        if not self._confirm_discard_edits():
            self._restore_last_state()
            return False
        year = self.sp_year.value()
        month = self.cb_month.currentIndex() + 1
        self.staff = ensure_role_count(
            self.staff, ROLE_DUTY, self.sp_count.value()
        )
        self.staff = ensure_role_count(
            self.staff, ROLE_EXTRA, self.sp_extra.value()
        )
        duty_members = [m for m in self.staff if m.role == ROLE_DUTY]
        five_members = [m for m in self.staff if m.role == ROLE_FIVE_DAY]
        extra_members = [m for m in self.staff if m.role == ROLE_EXTRA]

        # Если календарь пуст для выбранного месяца — заполняем выходными
        sample = date(year, month, 1)
        if sample not in self.prod_calendar.days:
            self._load_default_calendar()

        mode = self.cb_mode.currentData()
        if mode == "rotation":
            anchor = self.de_anchor.date().toPython()
            main = generate_rotation(
                year=year,
                month=month,
                engineers=[m.name for m in duty_members],
                anchor=anchor,
                prod_calendar=self.prod_calendar,
                use_holidays=self.chk_holidays.isChecked(),
                shift_hours=self.daily_hours,
            )
        else:
            calendars = self._calendars_for_chain(year)
            main = generate_linked(
                year=year,
                month=month,
                engineers=[m.name for m in duty_members],
                calendars=calendars,
                night_hours=self.night_hours,
                daily_hours=self.daily_hours,
                use_holidays=self.chk_holidays.isChecked(),
            )
        for eng, member in zip(main, duty_members):
            eng.position = member.position
        five = make_five_day_engineers(
            five_members,
            year,
            month,
            self.prod_calendar,
            self.workday_hours,
        )
        extras = make_extra_engineers(
            [m.name for m in extra_members], year, month
        )
        for eng, member in zip(extras, extra_members):
            eng.position = member.position

        self.engineers_data = main + five + extras
        self._rows = duty_members + five_members + extra_members
        self.norm_hours = self.prod_calendar.get_norm_hours(year, month)
        self._dirty = False
        self._last_state = {
            "year": year,
            "month": month,
            "mode": mode,
            "anchor": self.de_anchor.date().toString(Qt.ISODate),
            "count": len(duty_members),
            "extra_count": len(extra_members),
        }
        self._save_settings()
        save_staff(self.staff)

        self.schedule_widget.render(
            self.engineers_data,
            year,
            month,
            self.prod_calendar,
            self.night_hours,
            self.daily_hours,
        )
        self.stats_widget.update_stats(
            self._stats_engineers(), self.norm_hours
        )
        self._update_validation()
        self._update_conditions_label(mode)
        self._fit_window_to_content()
        return True

    def _fit_window_to_content(self):
        """Окно по ширине верхних панелей; график и статистика — на всю ширину."""
        layout = self.centralWidget().layout()
        margins = layout.contentsMargins()
        horizontal = margins.left() + margins.right()

        self._toolbar_layout.activate()
        self._params_layout.activate()
        controls_w = max(
            self._toolbar_layout.sizeHint().width(),
            self._params_layout.sizeHint().width(),
        )
        content_w = max(
            controls_w, self.schedule_widget.min_total_width()
        )

        self.schedule_widget.set_total_width(content_w)
        self.stats_widget.setFixedWidth(content_w)

        self.setMinimumWidth(0)
        self.setMaximumWidth(16777215)
        self.centralWidget().adjustSize()
        content_h = self.centralWidget().sizeHint().height()
        self.resize(content_w + horizontal, content_h)
        self.setFixedWidth(content_w + horizontal)


    def export_excel(self):
        if not self.engineers_data:
            QMessageBox.warning(
                self, "Нет данных", "Сначала сформируйте график."
            )
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "Сохранить как", "grafik.xlsx", "Excel (*.xlsx)"
        )
        if not path:
            return
        try:
            from io_.excel_export import export_to_excel

            export_to_excel(
                path,
                self.engineers_data,
                self.sp_year.value(),
                self.cb_month.currentIndex() + 1,
                self.prod_calendar,
            )
            QMessageBox.information(self, "Готово", f"Сохранено: {path}")
        except Exception as e:
            QMessageBox.critical(self, "Ошибка", str(e))
