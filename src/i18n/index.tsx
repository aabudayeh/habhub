import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { Alert, Platform } from "react-native";
import { showWebAlert } from "@/src/components/webAlertStore";

import { AppLanguage } from "@/src/types";
import { translateDomainText } from "@/src/i18n/domain";
import arGenerated from "@/src/i18n/catalogs/ar.json";
import deGenerated from "@/src/i18n/catalogs/de.json";
import esGenerated from "@/src/i18n/catalogs/es.json";
import frGenerated from "@/src/i18n/catalogs/fr.json";
import ruGenerated from "@/src/i18n/catalogs/ru.json";
import svGenerated from "@/src/i18n/catalogs/sv.json";
import zhHansGenerated from "@/src/i18n/catalogs/zh-Hans.json";

export type SupportedLanguage = {
  id: AppLanguage;
  label: string;
  nativeLabel: string;
  rtl?: boolean;
};

export const supportedLanguages: readonly SupportedLanguage[] = [
  { id: "en", label: "English", nativeLabel: "English" },
  { id: "ar", label: "Arabic", nativeLabel: "العربية", rtl: true },
  { id: "es", label: "Spanish", nativeLabel: "Español" },
  { id: "zh-Hans", label: "Chinese (Simplified)", nativeLabel: "简体中文" },
  { id: "sv", label: "Swedish", nativeLabel: "Svenska" },
  { id: "de", label: "German", nativeLabel: "Deutsch" },
  { id: "ru", label: "Russian", nativeLabel: "Русский" },
  { id: "fr", label: "French", nativeLabel: "Français" },
] as const;

export const appLocales: Record<AppLanguage, string> = {
  en: "en-US",
  ar: "ar-EG",
  es: "es-ES",
  "zh-Hans": "zh-CN",
  sv: "sv-SE",
  de: "de-DE",
  ru: "ru-RU",
  fr: "fr-FR",
};

export function localeForLanguage(language: AppLanguage) {
  return appLocales[normalizeAppLanguage(language)];
}

const catalogs: Record<Exclude<AppLanguage, "en">, Record<string, string>> = {
  ar: {
    Today: "اليوم", Log: "التسجيل", Leaderboard: "لوحة الصدارة", Progress: "التقدم",
    Chat: "الدردشة", Gym: "النادي الرياضي", Schedule: "الجدول", Journal: "اليوميات",
    Performance: "الأداء", Settings: "الإعدادات", Display: "العرض", Profile: "الملف الشخصي",
    Groups: "المجموعات", Notifications: "الإشعارات", Customize: "تخصيص", Badges: "الشارات",
    Recap: "الملخص", General: "عام", Advanced: "متقدم", Language: "اللغة",
    "Dark mode": "الوضع الداكن", "Compact layout": "التخطيط المضغوط", "Text size": "حجم النص",
    "Default landing page": "صفحة البداية", "Show pages": "إظهار الصفحات", "Today tiles": "بطاقات اليوم",
    Standard: "قياسي", Large: "كبير", "Extra large": "كبير جدًا", "Week starts on": "يبدأ الأسبوع يوم",
    Monday: "الاثنين", Sunday: "الأحد", Saturday: "السبت", "Time format": "تنسيق الوقت",
    "24 hour": "نظام 24 ساعة", "24-hour": "نظام 24 ساعة", "AM / PM": "ص / م", "AM/PM": "ص/م",
    "Fit more information on each screen": "عرض معلومات أكثر في كل شاشة",
    "Use the full dark color scheme": "استخدام نظام الألوان الداكن بالكامل",
    "Unread chat messages": "رسائل دردشة غير مقروءة",
    Add: "إضافة", Save: "حفظ", Delete: "حذف", Edit: "تعديل", Close: "إغلاق", Cancel: "إلغاء",
    Done: "تم", Back: "رجوع", Next: "التالي", Skip: "تخطي", Continue: "متابعة", Create: "إنشاء",
    Join: "انضمام", Leave: "مغادرة", Invite: "دعوة", Share: "مشاركة", Search: "بحث", Clear: "مسح",
    "Select all": "تحديد الكل", "Deselect all": "إلغاء تحديد الكل", Show: "إظهار", Hide: "إخفاء",
    Retry: "إعادة المحاولة", Refresh: "تحديث", "Sync now": "المزامنة الآن", "Get latest": "جلب الأحدث",
    "Sign in": "تسجيل الدخول", "Sign out": "تسجيل الخروج", Apply: "تطبيق", Reset: "إعادة ضبط",
    Remove: "إزالة", Update: "تحديث", Confirm: "تأكيد", Start: "بدء", Stop: "إيقاف", Pause: "إيقاف مؤقت",
    Resume: "استئناف", Finish: "إنهاء", Open: "فتح", View: "عرض", More: "المزيد",
    "No data": "لا توجد بيانات", "Not yet": "ليس بعد", Private: "خاص", Yesterday: "أمس",
    "This week": "هذا الأسبوع", "This month": "هذا الشهر", "This year": "هذه السنة", "All time": "كل الوقت",
    Day: "يوم", Week: "أسبوع", Month: "شهر", Year: "سنة", Loading: "جارٍ التحميل",
    "Loading…": "جارٍ التحميل…", "Your name": "اسمك", "Add a note": "أضف ملاحظة",
    "Write a message…": "اكتب رسالة…", Message: "رسالة", Email: "البريد الإلكتروني", Password: "كلمة المرور",
    "Group code": "رمز المجموعة", Optional: "اختياري",
  },
  es: {
    Today: "Hoy", Log: "Registro", Leaderboard: "Clasificación", Progress: "Progreso", Chat: "Chat",
    Gym: "Gimnasio", Schedule: "Agenda", Journal: "Diario", Performance: "Rendimiento", Settings: "Ajustes",
    Display: "Pantalla", Profile: "Perfil", Groups: "Grupos", Notifications: "Notificaciones",
    Customize: "Personalizar", Badges: "Insignias", Recap: "Resumen", General: "General", Advanced: "Avanzado",
    Language: "Idioma", "Dark mode": "Modo oscuro", "Compact layout": "Diseño compacto", "Text size": "Tamaño del texto",
    "Default landing page": "Página de inicio", "Show pages": "Mostrar páginas", "Today tiles": "Tarjetas de hoy",
    Standard: "Estándar", Large: "Grande", "Extra large": "Muy grande", "Week starts on": "La semana empieza el",
    Monday: "Lunes", Sunday: "Domingo", Saturday: "Sábado", "Time format": "Formato de hora",
    "24 hour": "24 horas", "24-hour": "24 horas", "AM / PM": "a. m. / p. m.", "AM/PM": "a. m./p. m.",
    "Fit more information on each screen": "Mostrar más información en cada pantalla",
    "Use the full dark color scheme": "Usar todo el esquema de colores oscuro",
    "Unread chat messages": "Mensajes de chat sin leer",
    Add: "Añadir", Save: "Guardar", Delete: "Eliminar", Edit: "Editar", Close: "Cerrar", Cancel: "Cancelar",
    Done: "Listo", Back: "Atrás", Next: "Siguiente", Skip: "Omitir", Continue: "Continuar", Create: "Crear",
    Join: "Unirse", Leave: "Salir", Invite: "Invitar", Share: "Compartir", Search: "Buscar", Clear: "Borrar",
    "Select all": "Seleccionar todo", "Deselect all": "Deseleccionar todo", Show: "Mostrar", Hide: "Ocultar",
    Retry: "Reintentar", Refresh: "Actualizar", "Sync now": "Sincronizar ahora", "Get latest": "Obtener lo último",
    "Sign in": "Iniciar sesión", "Sign out": "Cerrar sesión", Apply: "Aplicar", Reset: "Restablecer", Remove: "Quitar",
    Update: "Actualizar", Confirm: "Confirmar", Start: "Iniciar", Stop: "Detener", Pause: "Pausar", Resume: "Reanudar",
    Finish: "Finalizar", Open: "Abrir", View: "Ver", More: "Más", "No data": "Sin datos", "Not yet": "Aún no",
    Private: "Privado", Yesterday: "Ayer", "This week": "Esta semana", "This month": "Este mes",
    "This year": "Este año", "All time": "Todo el tiempo", Day: "Día", Week: "Semana", Month: "Mes", Year: "Año",
    Loading: "Cargando", "Loading…": "Cargando…", "Your name": "Tu nombre", "Add a note": "Añadir una nota",
    "Write a message…": "Escribe un mensaje…", Message: "Mensaje", Email: "Correo electrónico", Password: "Contraseña",
    "Group code": "Código del grupo", Optional: "Opcional",
  },
  "zh-Hans": {
    Today: "今天", Log: "记录", Leaderboard: "排行榜", Progress: "进度", Chat: "聊天", Gym: "健身",
    Schedule: "日程", Journal: "日记", Performance: "表现", Settings: "设置", Display: "显示", Profile: "个人资料",
    Groups: "群组", Notifications: "通知", Customize: "自定义", Badges: "徽章", Recap: "回顾", General: "常规",
    Advanced: "高级", Language: "语言", "Dark mode": "深色模式", "Compact layout": "紧凑布局", "Text size": "文字大小",
    "Default landing page": "默认首页", "Show pages": "显示页面", "Today tiles": "今日卡片", Add: "添加", Save: "保存",
    Standard: "标准", Large: "大", "Extra large": "特大", "Week starts on": "每周开始于", Monday: "星期一",
    Sunday: "星期日", Saturday: "星期六", "Time format": "时间格式", "24 hour": "24小时制",
    "24-hour": "24小时制", "AM / PM": "上午 / 下午", "AM/PM": "上午/下午",
    "Fit more information on each screen": "每屏显示更多信息",
    "Use the full dark color scheme": "使用完整深色配色", "Unread chat messages": "未读聊天消息",
    Delete: "删除", Edit: "编辑", Close: "关闭", Cancel: "取消", Done: "完成", Back: "返回", Next: "下一步",
    Skip: "跳过", Continue: "继续", Create: "创建", Join: "加入", Leave: "离开", Invite: "邀请", Share: "分享",
    Search: "搜索", Clear: "清除", "Select all": "全选", "Deselect all": "取消全选", Show: "显示", Hide: "隐藏",
    Retry: "重试", Refresh: "刷新", "Sync now": "立即同步", "Get latest": "获取最新", "Sign in": "登录",
    "Sign out": "退出登录", Apply: "应用", Reset: "重置", Remove: "移除", Update: "更新", Confirm: "确认",
    Start: "开始", Stop: "停止", Pause: "暂停", Resume: "继续", Finish: "结束", Open: "打开", View: "查看",
    More: "更多", "No data": "暂无数据", "Not yet": "尚未", Private: "私密", Yesterday: "昨天",
    "This week": "本周", "This month": "本月", "This year": "今年", "All time": "全部时间", Day: "日",
    Week: "周", Month: "月", Year: "年", Loading: "加载中", "Loading…": "加载中…", "Your name": "你的名字",
    "Add a note": "添加备注", "Write a message…": "输入消息…", Message: "消息", Email: "电子邮箱", Password: "密码",
    "Group code": "群组代码", Optional: "可选",
  },
  sv: {
    Today: "Idag", Log: "Logg", Leaderboard: "Topplista", Progress: "Framsteg", Chat: "Chatt", Gym: "Gym",
    Schedule: "Schema", Journal: "Dagbok", Performance: "Prestation", Settings: "Inställningar", Display: "Visning",
    Profile: "Profil", Groups: "Grupper", Notifications: "Aviseringar", Customize: "Anpassa", Badges: "Märken",
    Recap: "Sammanfattning", General: "Allmänt", Advanced: "Avancerat", Language: "Språk", "Dark mode": "Mörkt läge",
    "Compact layout": "Kompakt layout", "Text size": "Textstorlek", "Default landing page": "Standardstartsida",
    "Show pages": "Visa sidor", "Today tiles": "Dagens kort", Add: "Lägg till", Save: "Spara", Delete: "Radera",
    Standard: "Standard", Large: "Stort", "Extra large": "Extra stort", "Week starts on": "Veckan börjar på",
    Monday: "Måndag", Sunday: "Söndag", Saturday: "Lördag", "Time format": "Tidsformat",
    "24 hour": "24-timmars", "24-hour": "24-timmars", "AM / PM": "AM / PM", "AM/PM": "AM/PM",
    "Fit more information on each screen": "Visa mer information på varje skärm",
    "Use the full dark color scheme": "Använd hela det mörka färgschemat",
    "Unread chat messages": "Olästa chattmeddelanden",
    Edit: "Redigera", Close: "Stäng", Cancel: "Avbryt", Done: "Klar", Back: "Tillbaka", Next: "Nästa",
    Skip: "Hoppa över", Continue: "Fortsätt", Create: "Skapa", Join: "Gå med", Leave: "Lämna", Invite: "Bjud in",
    Share: "Dela", Search: "Sök", Clear: "Rensa", "Select all": "Välj alla", "Deselect all": "Avmarkera alla",
    Show: "Visa", Hide: "Dölj", Retry: "Försök igen", Refresh: "Uppdatera", "Sync now": "Synka nu",
    "Get latest": "Hämta senaste", "Sign in": "Logga in", "Sign out": "Logga ut", Apply: "Tillämpa", Reset: "Återställ",
    Remove: "Ta bort", Update: "Uppdatera", Confirm: "Bekräfta", Start: "Starta", Stop: "Stoppa", Pause: "Pausa",
    Resume: "Fortsätt", Finish: "Slutför", Open: "Öppna", View: "Visa", More: "Mer", "No data": "Ingen data",
    "Not yet": "Inte än", Private: "Privat", Yesterday: "Igår", "This week": "Den här veckan",
    "This month": "Den här månaden", "This year": "Det här året", "All time": "All tid", Day: "Dag", Week: "Vecka",
    Month: "Månad", Year: "År", Loading: "Laddar", "Loading…": "Laddar…", "Your name": "Ditt namn",
    "Add a note": "Lägg till anteckning", "Write a message…": "Skriv ett meddelande…", Message: "Meddelande",
    Email: "E-post", Password: "Lösenord", "Group code": "Gruppkod", Optional: "Valfritt",
  },
  de: {
    Today: "Heute", Log: "Protokoll", Leaderboard: "Rangliste", Progress: "Fortschritt", Chat: "Chat", Gym: "Training",
    Schedule: "Zeitplan", Journal: "Tagebuch", Performance: "Leistung", Settings: "Einstellungen", Display: "Anzeige",
    Profile: "Profil", Groups: "Gruppen", Notifications: "Benachrichtigungen", Customize: "Anpassen", Badges: "Abzeichen",
    Recap: "Rückblick", General: "Allgemein", Advanced: "Erweitert", Language: "Sprache", "Dark mode": "Dunkelmodus",
    "Compact layout": "Kompaktes Layout", "Text size": "Textgröße", "Default landing page": "Standard-Startseite",
    "Show pages": "Seiten anzeigen", "Today tiles": "Heutige Kacheln", Add: "Hinzufügen", Save: "Speichern",
    Standard: "Standard", Large: "Groß", "Extra large": "Sehr groß", "Week starts on": "Wochenbeginn",
    Monday: "Montag", Sunday: "Sonntag", Saturday: "Samstag", "Time format": "Zeitformat",
    "24 hour": "24 Stunden", "24-hour": "24 Stunden", "AM / PM": "AM / PM", "AM/PM": "AM/PM",
    "Fit more information on each screen": "Mehr Informationen pro Bildschirm anzeigen",
    "Use the full dark color scheme": "Vollständiges dunkles Farbschema verwenden",
    "Unread chat messages": "Ungelesene Chatnachrichten",
    Delete: "Löschen", Edit: "Bearbeiten", Close: "Schließen", Cancel: "Abbrechen", Done: "Fertig", Back: "Zurück",
    Next: "Weiter", Skip: "Überspringen", Continue: "Fortfahren", Create: "Erstellen", Join: "Beitreten", Leave: "Verlassen",
    Invite: "Einladen", Share: "Teilen", Search: "Suchen", Clear: "Leeren", "Select all": "Alle auswählen",
    "Deselect all": "Auswahl aufheben", Show: "Anzeigen", Hide: "Ausblenden", Retry: "Erneut versuchen",
    Refresh: "Aktualisieren", "Sync now": "Jetzt synchronisieren", "Get latest": "Neueste laden", "Sign in": "Anmelden",
    "Sign out": "Abmelden", Apply: "Anwenden", Reset: "Zurücksetzen", Remove: "Entfernen", Update: "Aktualisieren",
    Confirm: "Bestätigen", Start: "Starten", Stop: "Stoppen", Pause: "Pausieren", Resume: "Fortsetzen", Finish: "Beenden",
    Open: "Öffnen", View: "Ansehen", More: "Mehr", "No data": "Keine Daten", "Not yet": "Noch nicht", Private: "Privat",
    Yesterday: "Gestern", "This week": "Diese Woche", "This month": "Dieser Monat", "This year": "Dieses Jahr",
    "All time": "Gesamter Zeitraum", Day: "Tag", Week: "Woche", Month: "Monat", Year: "Jahr", Loading: "Wird geladen",
    "Loading…": "Wird geladen…", "Your name": "Dein Name", "Add a note": "Notiz hinzufügen",
    "Write a message…": "Nachricht schreiben…", Message: "Nachricht", Email: "E-Mail", Password: "Passwort",
    "Group code": "Gruppencode", Optional: "Optional",
  },
  ru: {
    Today: "Сегодня", Log: "Журнал", Leaderboard: "Рейтинг", Progress: "Прогресс", Chat: "Чат", Gym: "Тренировки",
    Schedule: "Расписание", Journal: "Дневник", Performance: "Результаты", Settings: "Настройки", Display: "Отображение",
    Profile: "Профиль", Groups: "Группы", Notifications: "Уведомления", Customize: "Настроить", Badges: "Награды",
    Recap: "Итоги", General: "Общие", Advanced: "Дополнительно", Language: "Язык", "Dark mode": "Тёмная тема",
    "Compact layout": "Компактный вид", "Text size": "Размер текста", "Default landing page": "Стартовая страница",
    "Show pages": "Показывать страницы", "Today tiles": "Карточки дня", Add: "Добавить", Save: "Сохранить",
    Standard: "Стандартный", Large: "Крупный", "Extra large": "Очень крупный", "Week starts on": "Начало недели",
    Monday: "Понедельник", Sunday: "Воскресенье", Saturday: "Суббота", "Time format": "Формат времени",
    "24 hour": "24 часа", "24-hour": "24 часа", "AM / PM": "12-часовой", "AM/PM": "12-часовой",
    "Fit more information on each screen": "Показывать больше информации на экране",
    "Use the full dark color scheme": "Использовать полную тёмную цветовую схему",
    "Unread chat messages": "Непрочитанные сообщения",
    Delete: "Удалить", Edit: "Изменить", Close: "Закрыть", Cancel: "Отмена", Done: "Готово", Back: "Назад",
    Next: "Далее", Skip: "Пропустить", Continue: "Продолжить", Create: "Создать", Join: "Вступить", Leave: "Выйти",
    Invite: "Пригласить", Share: "Поделиться", Search: "Поиск", Clear: "Очистить", "Select all": "Выбрать всё",
    "Deselect all": "Снять выбор", Show: "Показать", Hide: "Скрыть", Retry: "Повторить", Refresh: "Обновить",
    "Sync now": "Синхронизировать", "Get latest": "Получить обновления", "Sign in": "Войти", "Sign out": "Выйти",
    Apply: "Применить", Reset: "Сбросить", Remove: "Убрать", Update: "Обновить", Confirm: "Подтвердить",
    Start: "Начать", Stop: "Остановить", Pause: "Пауза", Resume: "Продолжить", Finish: "Завершить", Open: "Открыть",
    View: "Просмотр", More: "Ещё", "No data": "Нет данных", "Not yet": "Пока нет", Private: "Личное",
    Yesterday: "Вчера", "This week": "Эта неделя", "This month": "Этот месяц", "This year": "Этот год",
    "All time": "За всё время", Day: "День", Week: "Неделя", Month: "Месяц", Year: "Год", Loading: "Загрузка",
    "Loading…": "Загрузка…", "Your name": "Ваше имя", "Add a note": "Добавить заметку",
    "Write a message…": "Напишите сообщение…", Message: "Сообщение", Email: "Эл. почта", Password: "Пароль",
    "Group code": "Код группы", Optional: "Необязательно",
  },
  fr: {
    Today: "Aujourd’hui", Log: "Journal", Leaderboard: "Classement", Progress: "Progrès", Chat: "Discussion",
    Gym: "Salle", Schedule: "Planning", Journal: "Journal", Performance: "Performance", Settings: "Réglages",
    Display: "Affichage", Profile: "Profil", Groups: "Groupes", Notifications: "Notifications", Customize: "Personnaliser",
    Badges: "Badges", Recap: "Récapitulatif", General: "Général", Advanced: "Avancé", Language: "Langue",
    "Dark mode": "Mode sombre", "Compact layout": "Affichage compact", "Text size": "Taille du texte",
    "Default landing page": "Page d’accueil", "Show pages": "Afficher les pages", "Today tiles": "Cartes du jour",
    Standard: "Standard", Large: "Grand", "Extra large": "Très grand", "Week starts on": "La semaine commence le",
    Monday: "Lundi", Sunday: "Dimanche", Saturday: "Samedi", "Time format": "Format de l’heure",
    "24 hour": "24 heures", "24-hour": "24 heures", "AM / PM": "AM / PM", "AM/PM": "AM/PM",
    "Fit more information on each screen": "Afficher plus d’informations sur chaque écran",
    "Use the full dark color scheme": "Utiliser toute la palette sombre",
    "Unread chat messages": "Messages non lus",
    Add: "Ajouter", Save: "Enregistrer", Delete: "Supprimer", Edit: "Modifier", Close: "Fermer", Cancel: "Annuler",
    Done: "Terminé", Back: "Retour", Next: "Suivant", Skip: "Ignorer", Continue: "Continuer", Create: "Créer",
    Join: "Rejoindre", Leave: "Quitter", Invite: "Inviter", Share: "Partager", Search: "Rechercher", Clear: "Effacer",
    "Select all": "Tout sélectionner", "Deselect all": "Tout désélectionner", Show: "Afficher", Hide: "Masquer",
    Retry: "Réessayer", Refresh: "Actualiser", "Sync now": "Synchroniser", "Get latest": "Récupérer les nouveautés",
    "Sign in": "Se connecter", "Sign out": "Se déconnecter", Apply: "Appliquer", Reset: "Réinitialiser", Remove: "Retirer",
    Update: "Mettre à jour", Confirm: "Confirmer", Start: "Démarrer", Stop: "Arrêter", Pause: "Pause", Resume: "Reprendre",
    Finish: "Terminer", Open: "Ouvrir", View: "Voir", More: "Plus", "No data": "Aucune donnée", "Not yet": "Pas encore",
    Private: "Privé", Yesterday: "Hier", "This week": "Cette semaine", "This month": "Ce mois-ci",
    "This year": "Cette année", "All time": "Depuis toujours", Day: "Jour", Week: "Semaine", Month: "Mois", Year: "Année",
    Loading: "Chargement", "Loading…": "Chargement…", "Your name": "Votre nom", "Add a note": "Ajouter une note",
    "Write a message…": "Écrire un message…", Message: "Message", Email: "E-mail", Password: "Mot de passe",
    "Group code": "Code du groupe", Optional: "Facultatif",
  },
};

type SecondaryLanguage = Exclude<AppLanguage, "en">;
type TranslationRow = readonly [
  source: string,
  ar: string,
  es: string,
  zhHans: string,
  sv: string,
  de: string,
  ru: string,
  fr: string,
];

const secondaryLanguages: readonly SecondaryLanguage[] = [
  "ar",
  "es",
  "zh-Hans",
  "sv",
  "de",
  "ru",
  "fr",
];

// The generated offline catalogs provide exhaustive static-copy coverage.
// Curated inline translations below intentionally take priority where both
// sources contain a phrase.
const generatedCatalogs: Record<SecondaryLanguage, Record<string, string>> = {
  ar: arGenerated,
  de: deGenerated,
  es: esGenerated,
  fr: frGenerated,
  ru: ruGenerated,
  sv: svGenerated,
  "zh-Hans": zhHansGenerated,
};

// Shared screen, menu, editor, and accessibility copy. Tuple rows make it
// difficult to accidentally add a phrase to only some offline catalogs.
const commonTranslationRows = [
  ["Close dialog", "إغلاق النافذة", "Cerrar diálogo", "关闭对话框", "Stäng dialogrutan", "Dialog schließen", "Закрыть диалог", "Fermer la boîte de dialogue"],
  ["Not available yet", "غير متاح بعد", "Aún no disponible", "尚不可用", "Inte tillgängligt än", "Noch nicht verfügbar", "Пока недоступно", "Pas encore disponible"],
  ["Not available", "غير متاح", "No disponible", "不可用", "Inte tillgängligt", "Nicht verfügbar", "Недоступно", "Indisponible"],
  ["Log food to calculate today’s energy balance", "سجّل الطعام لحساب توازن الطاقة اليوم", "Registra alimentos para calcular el balance energético de hoy", "记录食物以计算今天的能量平衡", "Logga mat för att beräkna dagens energibalans", "Erfasse Essen, um die heutige Energiebilanz zu berechnen", "Запишите еду, чтобы рассчитать сегодняшний энергетический баланс", "Enregistrez vos repas pour calculer le bilan énergétique du jour"],
  ["Owner", "المالك", "Propietario", "所有者", "Ägare", "Eigentümer", "Владелец", "Propriétaire"],
  ["Admin", "المشرف", "Administrador", "管理员", "Administratör", "Administrator", "Администратор", "Administrateur"],
  ["Best", "الأفضل", "Mejor", "最佳", "Bäst", "Bestwert", "Лучший", "Meilleur"],
  ["WEEK", "الأسبوع", "SEMANA", "周", "VECKA", "WOCHE", "НЕДЕЛЯ", "SEMAINE"],
  ["Top gainers", "الأكثر تحسنًا", "Mayores avances", "进步最多", "Störst framsteg", "Größte Fortschritte", "Наибольший прогресс", "Meilleures progressions"],
  ["Steady", "مستقر", "Estable", "稳定", "Stabilt", "Stabil", "Стабильно", "Stable"],
  ["Need focus", "يحتاج إلى تركيز", "Requiere atención", "需要关注", "Behöver fokus", "Fokus nötig", "Требует внимания", "À travailler"],
  ["Building baseline", "جمع بيانات أولية", "Creando referencia", "正在建立基线", "Bygger baslinje", "Ausgangswert wird ermittelt", "Сбор исходных данных", "Référence en cours"],
  ["My schedule", "جدولي", "Mi agenda", "我的日程", "Mitt schema", "Mein Zeitplan", "Моё расписание", "Mon agenda"],
  ["Saved schedule views", "عروض الجدول المحفوظة", "Vistas guardadas de agenda", "已保存的日程视图", "Sparade schemavyer", "Gespeicherte Zeitplanansichten", "Сохранённые представления расписания", "Vues d’agenda enregistrées"],
  ["Low", "منخفض", "Baja", "低", "Låg", "Niedrig", "Низкий", "Faible"],
  ["Normal", "عادي", "Normal", "普通", "Normal", "Normal", "Обычный", "Normale"],
  ["High", "مرتفع", "Alta", "高", "Hög", "Hoch", "Высокий", "Élevée"],
  ["Urgent", "عاجل", "Urgente", "紧急", "Brådskande", "Dringend", "Срочный", "Urgente"],
  ["Customize trackers", "تخصيص أدوات التتبع", "Personalizar rastreadores", "自定义追踪项", "Anpassa spårare", "Tracker anpassen", "Настроить трекеры", "Personnaliser les suivis"],
  ["Open menu", "فتح القائمة", "Abrir menú", "打开菜单", "Öppna meny", "Menü öffnen", "Открыть меню", "Ouvrir le menu"],
  ["Open selection", "فتح قائمة الاختيار", "Abrir selección", "打开选择列表", "Öppna val", "Auswahl öffnen", "Открыть выбор", "Ouvrir la sélection"],
  ["Close menu", "إغلاق القائمة", "Cerrar menú", "关闭菜单", "Stäng meny", "Menü schließen", "Закрыть меню", "Fermer le menu"],
  ["Menu", "القائمة", "Menú", "菜单", "Meny", "Menü", "Меню", "Menu"],
  ["Previous", "السابق", "Anterior", "上一个", "Föregående", "Zurück", "Предыдущий", "Précédent"],
  ["Group", "المجموعة", "Grupo", "群组", "Grupp", "Gruppe", "Группа", "Groupe"],
  ["Public", "عام", "Público", "公开", "Offentlig", "Öffentlich", "Публичное", "Public"],
  ["Manual", "يدوي", "Manual", "手动", "Manuell", "Manuell", "Вручную", "Manuel"],
  ["Custom", "مخصص", "Personalizado", "自定义", "Anpassad", "Benutzerdefiniert", "Особый", "Personnalisé"],
  ["Overall", "الإجمالي", "General", "总体", "Totalt", "Gesamt", "Общий", "Global"],
  ["All", "الكل", "Todo", "全部", "Alla", "Alle", "Все", "Tout"],
  ["Success", "نجاح", "Éxito", "成功", "Klart", "Erfolg", "Готово", "Réussi"],
  ["Error", "خطأ", "Error", "错误", "Fel", "Fehler", "Ошибка", "Erreur"],
  ["Saved", "تم الحفظ", "Guardado", "已保存", "Sparat", "Gespeichert", "Сохранено", "Enregistré"],
  ["Saved locally", "محفوظ محليًا", "Guardado localmente", "已保存到本机", "Sparat lokalt", "Lokal gespeichert", "Сохранено локально", "Enregistré localement"],
  ["Pending", "قيد الانتظار", "Pendiente", "待处理", "Väntar", "Ausstehend", "Ожидает", "En attente"],
  ["Syncing", "جارٍ المزامنة", "Sincronizando", "同步中", "Synkar", "Synchronisierung", "Синхронизация", "Synchronisation"],
  ["Cloud on", "السحابة مفعلة", "Nube activa", "云端已开启", "Moln på", "Cloud aktiv", "Облако включено", "Cloud activé"],
  ["None selected", "لم يتم تحديد شيء", "Nada seleccionado", "未选择", "Inget valt", "Nichts ausgewählt", "Ничего не выбрано", "Aucune sélection"],
  ["No matching options", "لا توجد خيارات مطابقة", "No hay opciones coincidentes", "没有匹配选项", "Inga matchande alternativ", "Keine passenden Optionen", "Нет подходящих вариантов", "Aucune option correspondante"],
  ["No matching trackers", "لا توجد أدوات تتبع مطابقة", "No hay rastreadores coincidentes", "没有匹配的追踪项", "Inga matchande spårare", "Keine passenden Tracker", "Нет подходящих трекеров", "Aucun suivi correspondant"],
  ["Metrics", "المقاييس", "Métricas", "指标", "Mätvärden", "Messwerte", "Показатели", "Mesures"],
  ["No logged metrics", "لا توجد مقاييس مسجلة", "No hay métricas registradas", "没有已记录的指标", "Inga loggade mätvärden", "Keine protokollierten Messwerte", "Нет записанных показателей", "Aucune mesure enregistrée"],
  ["All Trackers", "كل أدوات التتبع", "Todos los rastreadores", "所有追踪项", "Alla spårare", "Alle Tracker", "Все трекеры", "Tous les suivis"],
  ["Tracked goals", "الأهداف المتتبعة", "Objetivos seguidos", "已追踪目标", "Spårade mål", "Verfolgte Ziele", "Отслеживаемые цели", "Objectifs suivis"],
  ["Progress items", "عناصر التقدم", "Elementos de progreso", "进度项目", "Framstegsobjekt", "Fortschrittselemente", "Элементы прогресса", "Éléments de progression"],
  ["Manage saved views", "إدارة طرق العرض المحفوظة", "Gestionar vistas guardadas", "管理已保存视图", "Hantera sparade vyer", "Gespeicherte Ansichten verwalten", "Управлять сохранёнными видами", "Gérer les vues enregistrées"],
  ["Goal", "هدف", "Objetivo", "目标", "Mål", "Ziel", "Цель", "Objectif"],
  ["goal", "الهدف", "objetivo", "目标", "mål", "Ziel", "цель", "objectif"],
  ["Show goals", "إظهار الأهداف", "Mostrar objetivos", "显示目标", "Visa mål", "Ziele anzeigen", "Показать цели", "Afficher les objectifs"],
  ["Hide goals", "إخفاء الأهداف", "Ocultar objetivos", "隐藏目标", "Dölj mål", "Ziele ausblenden", "Скрыть цели", "Masquer les objectifs"],
  ["Show trackers", "إظهار أدوات التتبع", "Mostrar rastreadores", "显示追踪项", "Visa spårare", "Tracker anzeigen", "Показать трекеры", "Afficher les suivis"],
  ["Hide trackers", "إخفاء أدوات التتبع", "Ocultar rastreadores", "隐藏追踪项", "Dölj spårare", "Tracker ausblenden", "Скрыть трекеры", "Masquer les suivis"],
  ["Hide all tracker tiles without changing goals or history", "إخفاء كل بطاقات التتبع دون تغيير الأهداف أو السجل", "Oculta todas las tarjetas sin cambiar los objetivos ni el historial", "隐藏所有追踪卡片，而不更改目标或历史记录", "Dölj alla spårarkort utan att ändra mål eller historik", "Alle Tracker-Karten ausblenden, ohne Ziele oder Verlauf zu ändern", "Скрыть все карточки трекеров, не меняя цели или историю", "Masquer toutes les cartes sans modifier les objectifs ni l’historique"],
  ["Every to-do complete", "اكتملت كل المهام", "Todas las tareas completadas", "所有待办事项均已完成", "Alla uppgifter är klara", "Alle Aufgaben erledigt", "Все задачи выполнены", "Toutes les tâches sont terminées"],
  ["No to-dos today", "لا توجد مهام اليوم", "No hay tareas hoy", "今天没有待办事项", "Inga uppgifter idag", "Heute keine Aufgaben", "Сегодня нет задач", "Aucune tâche aujourd’hui"],
  ["TO-DOS", "المهام", "TAREAS", "待办事项", "UPPGIFTER", "AUFGABEN", "ЗАДАЧИ", "TÂCHES"],
  ["Line and bars", "خط وأعمدة", "Línea y barras", "折线和柱形", "Linje och staplar", "Linie und Balken", "Линия и столбцы", "Courbe et barres"],
  ["Open daily status", "فتح حالة اليوم", "Abrir estado diario", "打开每日状态", "Öppna dagens status", "Tagesstatus öffnen", "Открыть статус дня", "Ouvrir l’état du jour"],
  ["Status", "الحالة", "Estado", "状态", "Status", "Status", "Статус", "État"],
  ["Fasting", "الصيام", "Ayuno", "禁食", "Fasta", "Fasten", "Голодание", "Jeûne"],
  ["Intermittent fasting", "الصيام المتقطع", "Ayuno intermitente", "间歇性禁食", "Periodisk fasta", "Intervallfasten", "Интервальное голодание", "Jeûne intermittent"],
  ["Schedule items", "عناصر الجدول", "Elementos de la agenda", "日程项目", "Schemaposter", "Zeitplaneinträge", "Элементы расписания", "Éléments du planning"],
  ["Activities", "الأنشطة", "Actividades", "活动", "Aktiviteter", "Aktivitäten", "Действия", "Activités"],
  ["All day", "طوال اليوم", "Todo el día", "全天", "Hela dagen", "Ganztägig", "Весь день", "Toute la journée"],
  ["No items in this slot", "لا توجد عناصر في هذه الفترة", "No hay elementos en este intervalo", "此时间段没有项目", "Inga poster i den här tiden", "Keine Einträge in diesem Zeitfenster", "В этом интервале нет элементов", "Aucun élément dans ce créneau"],
  ["Only on this date", "في هذا التاريخ فقط", "Solo en esta fecha", "仅在此日期", "Endast detta datum", "Nur an diesem Datum", "Только в эту дату", "Uniquement à cette date"],
  ["Every day from this date", "كل يوم بدءًا من هذا التاريخ", "Cada día desde esta fecha", "从此日期起每天", "Varje dag från detta datum", "Ab diesem Datum täglich", "Каждый день с этой даты", "Chaque jour à partir de cette date"],
  ["On this weekday", "في يوم الأسبوع هذا", "En este día de la semana", "在每周的这一天", "På den här veckodagen", "An diesem Wochentag", "В этот день недели", "Ce jour de la semaine"],
  ["On this date each month", "في هذا التاريخ من كل شهر", "En esta fecha cada mes", "每月此日", "På detta datum varje månad", "Jeden Monat an diesem Datum", "В эту дату каждого месяца", "À cette date chaque mois"],
  ["The cloud did not return an error description.", "لم تُرجع السحابة وصفًا للخطأ.", "La nube no devolvió una descripción del error.", "云端未返回错误说明。", "Molnet returnerade ingen felbeskrivning.", "Die Cloud hat keine Fehlerbeschreibung zurückgegeben.", "Облако не вернуло описание ошибки.", "Le cloud n’a renvoyé aucune description de l’erreur."],
  ["Remaining", "المتبقي", "Restante", "剩余", "Återstår", "Verbleibend", "Осталось", "Restant"],
  ["remaining", "متبقٍ", "restante", "剩余", "återstår", "verbleibend", "осталось", "restant"],
  ["Goals", "الأهداف", "Objetivos", "目标", "Mål", "Ziele", "Цели", "Objectifs"],
  ["Daily goal", "الهدف اليومي", "Objetivo diario", "每日目标", "Dagligt mål", "Tagesziel", "Дневная цель", "Objectif quotidien"],
  ["Goal met", "تم تحقيق الهدف", "Objetivo cumplido", "目标已达成", "Mål uppnått", "Ziel erreicht", "Цель достигнута", "Objectif atteint"],
  ["Goal status", "حالة الهدف", "Estado del objetivo", "目标状态", "Målstatus", "Zielstatus", "Статус цели", "Statut de l’objectif"],
  ["Goal status only", "حالة الهدف فقط", "Solo estado del objetivo", "仅显示目标状态", "Endast målstatus", "Nur Zielstatus", "Только статус цели", "Statut de l’objectif uniquement"],
  ["Tracking only", "للتتبع فقط", "Solo seguimiento", "仅跟踪", "Endast spårning", "Nur Erfassung", "Только отслеживание", "Suivi uniquement"],
  ["Only me", "أنا فقط", "Solo yo", "仅自己", "Bara jag", "Nur ich", "Только я", "Moi uniquement"],
  ["Exact value", "القيمة الدقيقة", "Valor exacto", "精确数值", "Exakt värde", "Exakter Wert", "Точное значение", "Valeur exacte"],
  ["Breakfast", "الإفطار", "Desayuno", "早餐", "Frukost", "Frühstück", "Завтрак", "Petit-déjeuner"],
  ["breakfast", "الإفطار", "desayuno", "早餐", "frukost", "Frühstück", "завтрак", "petit-déjeuner"],
  ["Lunch", "الغداء", "Almuerzo", "午餐", "Lunch", "Mittagessen", "Обед", "Déjeuner"],
  ["lunch", "الغداء", "almuerzo", "午餐", "lunch", "Mittagessen", "обед", "déjeuner"],
  ["Dinner", "العشاء", "Cena", "晚餐", "Middag", "Abendessen", "Ужин", "Dîner"],
  ["dinner", "العشاء", "cena", "晚餐", "middag", "Abendessen", "ужин", "dîner"],
  ["Snack", "وجبة خفيفة", "Tentempié", "加餐", "Mellanmål", "Snack", "Перекус", "Collation"],
  ["snack", "وجبة خفيفة", "tentempié", "加餐", "mellanmål", "Snack", "перекус", "collation"],
  ["Last synced", "آخر مزامنة", "Última sincronización", "上次同步", "Senast synkad", "Zuletzt synchronisiert", "Последняя синхронизация", "Dernière synchronisation"],
  ["Synced now", "تمت المزامنة الآن", "Sincronizado ahora", "刚刚同步", "Synkad nu", "Gerade synchronisiert", "Синхронизировано сейчас", "Synchronisé à l’instant"],
  ["now", "الآن", "ahora", "刚刚", "nu", "jetzt", "сейчас", "à l’instant"],
  ["Set start adjustment", "تعديل بداية المجموعة", "Ajuste del inicio de la serie", "组开始时间调整", "Justering av setstart", "Anpassung des Satzstarts", "Поправка начала подхода", "Ajustement du début de série"],
  ["DIA", "انبساطي", "DIA", "舒张压", "DIA", "DIA", "ДИА", "DIA"],
  ["SYS", "انقباضي", "SIS", "收缩压", "SYS", "SYS", "СИС", "SYS"],
  ["Logged", "مُسجّل", "Registrado", "已记录", "Loggat", "Protokolliert", "Записано", "Enregistré"],
  ["Not logged", "غير مُسجّل", "No registrado", "未记录", "Inte loggat", "Nicht protokolliert", "Не записано", "Non enregistré"],
  ["Pin {value1}", "تثبيت {value1}", "Fijar {value1}", "置顶 {value1}", "Fäst {value1}", "{value1} anheften", "Закрепить {value1}", "Épingler {value1}"],
  ["Unpin {value1}", "إلغاء تثبيت {value1}", "Desfijar {value1}", "取消置顶 {value1}", "Lossa {value1}", "{value1} lösen", "Открепить {value1}", "Désépingler {value1}"],
  ["Grey: not logged. Red: goal missed. Pink: skipped or vacation. Lime: goal met. Orange: logged without a goal.", "الرمادي: غير مُسجّل. الأحمر: لم يتحقق الهدف. الوردي: تم التخطي أو إجازة. الأخضر الليموني: تحقق الهدف. البرتقالي: مُسجّل بلا هدف.", "Gris: no registrado. Rojo: objetivo no cumplido. Rosa: omitido o vacaciones. Verde lima: objetivo cumplido. Naranja: registrado sin objetivo.", "灰色：未记录。红色：目标未达成。粉色：已跳过或休假。亮绿色：目标已达成。橙色：已记录但未设目标。", "Grått: inte loggat. Rött: målet missades. Rosa: hoppades över eller semester. Limegrönt: målet nåddes. Orange: loggat utan mål.", "Grau: nicht protokolliert. Rot: Ziel verfehlt. Rosa: übersprungen oder Urlaub. Limettengrün: Ziel erreicht. Orange: ohne Ziel protokolliert.", "Серый: не записано. Красный: цель не достигнута. Розовый: пропуск или отпуск. Лаймовый: цель достигнута. Оранжевый: записано без цели.", "Gris : non enregistré. Rouge : objectif non atteint. Rose : ignoré ou vacances. Vert citron : objectif atteint. Orange : enregistré sans objectif."],
  ["Lime and gold are reserved for completed goals.", "الأخضر الليموني والذهبي مخصصان للأهداف المكتملة.", "El verde lima y el dorado están reservados para objetivos cumplidos.", "亮绿色和金色专用于已完成的目标。", "Limegrönt och guld är reserverade för uppnådda mål.", "Limettengrün und Gold sind für erreichte Ziele reserviert.", "Лаймовый и золотой цвета предназначены для достигнутых целей.", "Le vert citron et l’or sont réservés aux objectifs atteints."],
  ["Lime and gold are reserved for goal-completion feedback.", "الأخضر الليموني والذهبي مخصصان لملاحظات إكمال الأهداف.", "El verde lima y el dorado están reservados para indicar objetivos cumplidos.", "亮绿色和金色专用于目标完成反馈。", "Limegrönt och guld är reserverade för återkoppling om uppnådda mål.", "Limettengrün und Gold sind für Rückmeldungen zu erreichten Zielen reserviert.", "Лаймовый и золотой цвета предназначены для отметки достигнутых целей.", "Le vert citron et l’or sont réservés aux indications d’objectifs atteints."],
  ["Lime and gold stay reserved for completed goals.", "يبقى الأخضر الليموني والذهبي مخصصين للأهداف المكتملة.", "El verde lima y el dorado siguen reservados para objetivos cumplidos.", "亮绿色和金色仍专用于已完成的目标。", "Limegrönt och guld förblir reserverade för uppnådda mål.", "Limettengrün und Gold bleiben erreichten Zielen vorbehalten.", "Лаймовый и золотой цвета остаются для достигнутых целей.", "Le vert citron et l’or restent réservés aux objectifs atteints."],
  ["Not met", "لم يتحقق", "No cumplido", "未达成", "Inte uppnått", "Nicht erreicht", "Не достигнуто", "Non atteint"],
  ["Tracked goal", "هدف متتبع", "Objetivo seguido", "已追踪目标", "Spårat mål", "Verfolgtes Ziel", "Отслеживаемая цель", "Objectif suivi"],
  ["No goals are currently tracked.", "لا توجد أهداف متتبعة حاليًا.", "Actualmente no se sigue ningún objetivo.", "目前没有追踪目标。", "Inga mål spåras just nu.", "Derzeit werden keine Ziele verfolgt.", "Сейчас цели не отслеживаются.", "Aucun objectif n’est suivi actuellement."],
  ["Log entry", "إدخال سجل", "Entrada de registro", "记录条目", "Loggpost", "Protokolleintrag", "Запись журнала", "Entrée de journal"],
  ["Add entry", "إضافة إدخال", "Añadir entrada", "添加记录", "Lägg till post", "Eintrag hinzufügen", "Добавить запись", "Ajouter une entrée"],
  ["Save entry", "حفظ الإدخال", "Guardar entrada", "保存记录", "Spara post", "Eintrag speichern", "Сохранить запись", "Enregistrer l’entrée"],
  ["Save today's total", "حفظ إجمالي اليوم", "Guardar total de hoy", "保存今日总计", "Spara dagens total", "Heutige Summe speichern", "Сохранить итог за сегодня", "Enregistrer le total du jour"],
  ["What are you adding?", "ماذا تضيف؟", "¿Qué vas a añadir?", "你要添加什么？", "Vad lägger du till?", "Was möchtest du hinzufügen?", "Что вы добавляете?", "Qu’ajoutez-vous ?"],
  ["Choose tracker", "اختيار أداة تتبع", "Elegir rastreador", "选择追踪项", "Välj spårare", "Tracker auswählen", "Выбрать трекер", "Choisir un suivi"],
  ["Imported value", "قيمة مستوردة", "Valor importado", "导入值", "Importerat värde", "Importierter Wert", "Импортированное значение", "Valeur importée"],
  ["Health source", "مصدر البيانات الصحية", "Fuente de salud", "健康数据来源", "Hälsokälla", "Gesundheitsquelle", "Источник данных о здоровье", "Source de santé"],
  ["Tracker name", "اسم أداة التتبع", "Nombre del rastreador", "追踪项名称", "Spårarens namn", "Trackername", "Название трекера", "Nom du suivi"],
  ["Unit", "الوحدة", "Unidad", "单位", "Enhet", "Einheit", "Единица", "Unité"],
  ["Unit (optional)", "الوحدة (اختياري)", "Unidad (opcional)", "单位（可选）", "Enhet (valfritt)", "Einheit (optional)", "Единица (необязательно)", "Unité (facultatif)"],
  ["Add tracker", "إضافة أداة تتبع", "Añadir rastreador", "添加追踪项", "Lägg till spårare", "Tracker hinzufügen", "Добавить трекер", "Ajouter un suivi"],
  ["Add custom tracker", "إضافة أداة تتبع مخصصة", "Añadir rastreador personalizado", "添加自定义追踪项", "Lägg till egen spårare", "Eigenen Tracker hinzufügen", "Добавить свой трекер", "Ajouter un suivi personnalisé"],
  ["Group settings", "إعدادات المجموعة", "Ajustes del grupo", "群组设置", "Gruppinställningar", "Gruppeneinstellungen", "Настройки группы", "Réglages du groupe"],
  ["Group name", "اسم المجموعة", "Nombre del grupo", "群组名称", "Gruppnamn", "Gruppenname", "Название группы", "Nom du groupe"],
  ["Group color", "لون المجموعة", "Color del grupo", "群组颜色", "Gruppfärg", "Gruppenfarbe", "Цвет группы", "Couleur du groupe"],
  ["Your groups", "مجموعاتك", "Tus grupos", "你的群组", "Dina grupper", "Deine Gruppen", "Ваши группы", "Vos groupes"],
  ["Manage groups", "إدارة المجموعات", "Gestionar grupos", "管理群组", "Hantera grupper", "Gruppen verwalten", "Управление группами", "Gérer les groupes"],
  ["Create a group", "إنشاء مجموعة", "Crear un grupo", "创建群组", "Skapa en grupp", "Gruppe erstellen", "Создать группу", "Créer un groupe"],
  ["Join with a code", "الانضمام باستخدام رمز", "Unirse con un código", "使用代码加入", "Gå med med en kod", "Mit Code beitreten", "Вступить по коду", "Rejoindre avec un code"],
  ["Join requests", "طلبات الانضمام", "Solicitudes de ingreso", "加入请求", "Förfrågningar", "Beitrittsanfragen", "Запросы на вступление", "Demandes d’adhésion"],
  ["Invite code", "رمز الدعوة", "Código de invitación", "邀请码", "Inbjudningskod", "Einladungscode", "Код приглашения", "Code d’invitation"],
  ["Share invite", "مشاركة الدعوة", "Compartir invitación", "分享邀请", "Dela inbjudan", "Einladung teilen", "Поделиться приглашением", "Partager l’invitation"],
  ["Group updates", "تحديثات المجموعة", "Novedades del grupo", "群组动态", "Gruppuppdateringar", "Gruppenupdates", "Новости группы", "Actualités du groupe"],
  ["Your updates", "تحديثاتك", "Tus novedades", "你的动态", "Dina uppdateringar", "Deine Updates", "Ваши обновления", "Vos actualités"],
  ["Start the conversation", "ابدأ المحادثة", "Inicia la conversación", "开始聊天", "Starta konversationen", "Unterhaltung beginnen", "Начать разговор", "Lancer la conversation"],
  ["Cheer", "تشجيع", "Animar", "鼓励", "Heja", "Anfeuern", "Поддержать", "Encourager"],
  ["Taunt", "تحدٍّ", "Provocar", "挑衅", "Utmana", "Sticheln", "Поддразнить", "Taquiner"],
  ["Remind", "تذكير", "Recordar", "提醒", "Påminn", "Erinnern", "Напомнить", "Rappeler"],
  ["Send", "إرسال", "Enviar", "发送", "Skicka", "Senden", "Отправить", "Envoyer"],
  ["Reply", "رد", "Responder", "回复", "Svara", "Antworten", "Ответить", "Répondre"],
  ["New note", "ملاحظة جديدة", "Nueva nota", "新建笔记", "Ny anteckning", "Neue Notiz", "Новая заметка", "Nouvelle note"],
  ["Edit note", "تعديل الملاحظة", "Editar nota", "编辑笔记", "Redigera anteckning", "Notiz bearbeiten", "Изменить заметку", "Modifier la note"],
  ["Save note", "حفظ الملاحظة", "Guardar nota", "保存笔记", "Spara anteckning", "Notiz speichern", "Сохранить заметку", "Enregistrer la note"],
  ["Write anything…", "اكتب أي شيء…", "Escribe lo que quieras…", "写点什么…", "Skriv vad som helst…", "Schreib etwas…", "Напишите что-нибудь…", "Écrivez ce que vous voulez…"],
  ["Search every note", "البحث في كل الملاحظات", "Buscar en todas las notas", "搜索所有笔记", "Sök i alla anteckningar", "Alle Notizen durchsuchen", "Искать во всех заметках", "Rechercher dans toutes les notes"],
  ["Filter notes", "تصفية الملاحظات", "Filtrar notas", "筛选笔记", "Filtrera anteckningar", "Notizen filtern", "Фильтровать заметки", "Filtrer les notes"],
  ["All notes", "كل الملاحظات", "Todas las notas", "所有笔记", "Alla anteckningar", "Alle Notizen", "Все заметки", "Toutes les notes"],
  ["No matching notes yet.", "لا توجد ملاحظات مطابقة بعد.", "Aún no hay notas coincidentes.", "暂无匹配笔记。", "Inga matchande anteckningar än.", "Noch keine passenden Notizen.", "Подходящих заметок пока нет.", "Aucune note correspondante pour le moment."],
  ["Journal notes", "ملاحظات اليوميات", "Notas del diario", "日记笔记", "Dagboksanteckningar", "Tagebuchnotizen", "Заметки дневника", "Notes du journal"],
  ["Add image", "إضافة صورة", "Añadir imagen", "添加图片", "Lägg till bild", "Bild hinzufügen", "Добавить изображение", "Ajouter une image"],
  ["Change image", "تغيير الصورة", "Cambiar imagen", "更换图片", "Byt bild", "Bild ändern", "Изменить изображение", "Changer l’image"],
  ["Organize this note", "تنظيم هذه الملاحظة", "Organizar esta nota", "整理此笔记", "Organisera anteckningen", "Diese Notiz organisieren", "Организовать заметку", "Organiser cette note"],
  ["Trackers and labels", "أدوات التتبع والتصنيفات", "Rastreadores y etiquetas", "追踪项和标签", "Spårare och etiketter", "Tracker und Labels", "Трекеры и метки", "Suivis et étiquettes"],
  ["No links", "لا توجد روابط", "Sin enlaces", "无关联", "Inga länkar", "Keine Verknüpfungen", "Нет связей", "Aucun lien"],
  ["Date range", "النطاق الزمني", "Intervalo de fechas", "日期范围", "Datumintervall", "Zeitraum", "Диапазон дат", "Plage de dates"],
  ["Range avg", "متوسط النطاق", "Promedio del intervalo", "区间平均值", "Intervallsnitt", "Bereichsdurchschnitt", "Среднее за период", "Moyenne de la période"],
  ["7-day avg", "متوسط 7 أيام", "Promedio de 7 días", "7天平均值", "7-dagarssnitt", "7-Tage-Durchschnitt", "Среднее за 7 дней", "Moyenne sur 7 jours"],
  ["30-day avg", "متوسط 30 يومًا", "Promedio de 30 días", "30天平均值", "30-dagarssnitt", "30-Tage-Durchschnitt", "Среднее за 30 дней", "Moyenne sur 30 jours"],
  ["Average vs goal", "المتوسط مقابل الهدف", "Promedio frente al objetivo", "平均值与目标", "Snitt mot mål", "Durchschnitt vs. Ziel", "Среднее и цель", "Moyenne par rapport à l’objectif"],
  ["Period total", "إجمالي الفترة", "Total del periodo", "周期总计", "Periodtotal", "Zeitraumsumme", "Итог за период", "Total de la période"],
  ["Best day", "أفضل يوم", "Mejor día", "最佳一天", "Bästa dag", "Bester Tag", "Лучший день", "Meilleur jour"],
  ["No logs on this day", "لا توجد سجلات في هذا اليوم", "No hay registros este día", "当天没有记录", "Inga loggar den här dagen", "Keine Einträge an diesem Tag", "В этот день записей нет", "Aucun journal ce jour-là"],
  ["Week summaries", "ملخصات الأسبوع", "Resúmenes semanales", "周摘要", "Veckosammanfattningar", "Wochenzusammenfassungen", "Итоги недели", "Résumés hebdomadaires"],
  ["Month summaries", "ملخصات الشهر", "Resúmenes mensuales", "月摘要", "Månadssammanfattningar", "Monatszusammenfassungen", "Итоги месяца", "Résumés mensuels"],
  ["Open notifications", "فتح الإشعارات", "Abrir notificaciones", "打开通知", "Öppna aviseringar", "Benachrichtigungen öffnen", "Открыть уведомления", "Ouvrir les notifications"],
  ["Close information", "إغلاق المعلومات", "Cerrar información", "关闭信息", "Stäng information", "Information schließen", "Закрыть информацию", "Fermer les informations"],
  ["Search default metrics", "البحث في المقاييس الافتراضية", "Buscar métricas predeterminadas", "搜索默认指标", "Sök standardmätvärden", "Standardmesswerte durchsuchen", "Искать стандартные показатели", "Rechercher les mesures par défaut"],
  ["Close image", "إغلاق الصورة", "Cerrar imagen", "关闭图片", "Stäng bild", "Bild schließen", "Закрыть изображение", "Fermer l’image"],
  ["Open journal", "فتح اليوميات", "Abrir diario", "打开日记", "Öppna dagbok", "Tagebuch öffnen", "Открыть дневник", "Ouvrir le journal"],
  ["Customize Today", "تخصيص اليوم", "Personalizar Hoy", "自定义今天", "Anpassa Idag", "Heute anpassen", "Настроить Сегодня", "Personnaliser Aujourd’hui"],
  ["Customize Progress", "تخصيص التقدم", "Personalizar Progreso", "自定义进度", "Anpassa Framsteg", "Fortschritt anpassen", "Настроить Прогресс", "Personnaliser la progression"],
  ["Add exercise", "إضافة تمرين", "Añadir ejercicio", "添加动作", "Lägg till övning", "Übung hinzufügen", "Добавить упражнение", "Ajouter un exercice"],
  ["Add set", "إضافة مجموعة", "Añadir serie", "添加组", "Lägg till set", "Satz hinzufügen", "Добавить подход", "Ajouter une série"],
  ["Save workout", "حفظ التمرين", "Guardar entrenamiento", "保存训练", "Spara träningspass", "Training speichern", "Сохранить тренировку", "Enregistrer l’entraînement"],
  ["Start workout", "بدء التمرين", "Iniciar entrenamiento", "开始训练", "Starta träningspass", "Training starten", "Начать тренировку", "Démarrer l’entraînement"],
  ["Finish exercise", "إنهاء التمرين", "Finalizar ejercicio", "完成动作", "Avsluta övning", "Übung beenden", "Завершить упражнение", "Terminer l’exercice"],
  ["Exercise complete", "اكتمل التمرين", "Ejercicio completado", "动作已完成", "Övning klar", "Übung abgeschlossen", "Упражнение завершено", "Exercice terminé"],
  ["Download collage", "تنزيل الصورة المجمعة", "Descargar collage", "下载拼图", "Ladda ner kollage", "Collage herunterladen", "Скачать коллаж", "Télécharger le collage"],
  ["Save or share collage", "حفظ الصورة المجمعة أو مشاركتها", "Guardar o compartir collage", "保存或分享拼图", "Spara eller dela kollage", "Collage speichern oder teilen", "Сохранить или поделиться коллажем", "Enregistrer ou partager le collage"],
  ["Add to group", "إضافة إلى المجموعة", "Añadir al grupo", "添加到群组", "Lägg till i grupp", "Zur Gruppe hinzufügen", "Добавить в группу", "Ajouter au groupe"],
  ["Save template", "حفظ القالب", "Guardar plantilla", "保存模板", "Spara mall", "Vorlage speichern", "Сохранить шаблон", "Enregistrer le modèle"],
  ["Timer", "المؤقت", "Temporizador", "计时器", "Timer", "Timer", "Таймер", "Minuteur"],
  ["Stopwatch", "ساعة إيقاف", "Cronómetro", "秒表", "Stoppur", "Stoppuhr", "Секундомер", "Chronomètre"],
  ["Countdown", "عد تنازلي", "Cuenta atrás", "倒计时", "Nedräkning", "Countdown", "Обратный отсчёт", "Compte à rebours"],
  ["Reminders", "التذكيرات", "Recordatorios", "提醒", "Påminnelser", "Erinnerungen", "Напоминания", "Rappels"],
  ["New reminder", "تذكير جديد", "Nuevo recordatorio", "新建提醒", "Ny påminnelse", "Neue Erinnerung", "Новое напоминание", "Nouveau rappel"],
  ["Edit reminder", "تعديل التذكير", "Editar recordatorio", "编辑提醒", "Redigera påminnelse", "Erinnerung bearbeiten", "Изменить напоминание", "Modifier le rappel"],
  ["Save reminder", "حفظ التذكير", "Guardar recordatorio", "保存提醒", "Spara påminnelse", "Erinnerung speichern", "Сохранить напоминание", "Enregistrer le rappel"],
  ["To-Dos", "المهام", "Tareas", "待办事项", "Att göra", "Aufgaben", "Задачи", "Tâches"],
  ["New to-do", "مهمة جديدة", "Nueva tarea", "新建待办", "Ny uppgift", "Neue Aufgabe", "Новая задача", "Nouvelle tâche"],
  ["Edit to-do", "تعديل المهمة", "Editar tarea", "编辑待办", "Redigera uppgift", "Aufgabe bearbeiten", "Изменить задачу", "Modifier la tâche"],
  ["Save to-do", "حفظ المهمة", "Guardar tarea", "保存待办", "Spara uppgift", "Aufgabe speichern", "Сохранить задачу", "Enregistrer la tâche"],
  ["Description or note (optional)", "وصف أو ملاحظة (اختياري)", "Descripción o nota (opcional)", "描述或备注（可选）", "Beskrivning eller anteckning (valfritt)", "Beschreibung oder Notiz (optional)", "Описание или заметка (необязательно)", "Description ou note (facultatif)"],
  ["What needs doing?", "ما الذي يجب إنجازه؟", "¿Qué hay que hacer?", "需要做什么？", "Vad behöver göras?", "Was ist zu erledigen?", "Что нужно сделать?", "Que faut-il faire ?"],
  ["Save this note?", "هل تريد حفظ هذه الملاحظة؟", "¿Guardar esta nota?", "保存此笔记？", "Spara anteckningen?", "Diese Notiz speichern?", "Сохранить эту заметку?", "Enregistrer cette note ?"],
  ["This note has unsaved changes.", "تحتوي هذه الملاحظة على تغييرات غير محفوظة.", "Esta nota tiene cambios sin guardar.", "此笔记有未保存的更改。", "Anteckningen har osparade ändringar.", "Diese Notiz enthält ungespeicherte Änderungen.", "В этой заметке есть несохранённые изменения.", "Cette note contient des modifications non enregistrées."],
  ["Keep editing", "متابعة التعديل", "Seguir editando", "继续编辑", "Fortsätt redigera", "Weiter bearbeiten", "Продолжить редактирование", "Continuer la modification"],
  ["Discard", "تجاهل", "Descartar", "放弃", "Kasta", "Verwerfen", "Отменить изменения", "Ignorer"],
  ["Write a note", "اكتب ملاحظة", "Escribe una nota", "写一条笔记", "Skriv en anteckning", "Notiz schreiben", "Напишите заметку", "Écrivez une note"],
  ["The note cannot be empty.", "لا يمكن أن تكون الملاحظة فارغة.", "La nota no puede estar vacía.", "笔记不能为空。", "Anteckningen får inte vara tom.", "Die Notiz darf nicht leer sein.", "Заметка не может быть пустой.", "La note ne peut pas être vide."],
  ["Delete note?", "حذف الملاحظة؟", "¿Eliminar nota?", "删除笔记？", "Radera anteckning?", "Notiz löschen?", "Удалить заметку?", "Supprimer la note ?"],
  ["Save your changes?", "هل تريد حفظ تغييراتك؟", "¿Guardar tus cambios?", "保存更改？", "Spara ändringarna?", "Änderungen speichern?", "Сохранить изменения?", "Enregistrer vos modifications ?"],
  ["You have unsaved changes.", "لديك تغييرات غير محفوظة.", "Tienes cambios sin guardar.", "你有未保存的更改。", "Du har osparade ändringar.", "Du hast ungespeicherte Änderungen.", "У вас есть несохранённые изменения.", "Vous avez des modifications non enregistrées."],
  ["Are you sure?", "هل أنت متأكد؟", "¿Seguro?", "确定吗？", "Är du säker?", "Bist du sicher?", "Вы уверены?", "Êtes-vous sûr ?"],
  ["Something went wrong.", "حدث خطأ ما.", "Algo salió mal.", "出现了问题。", "Något gick fel.", "Etwas ist schiefgelaufen.", "Что-то пошло не так.", "Un problème est survenu."],
  ["Share mapped workout results", "مشاركة نتائج التمرين المرتبطة", "Compartir resultados de entrenamiento vinculados", "分享关联的锻炼结果", "Dela kopplade träningsresultat", "Zugeordnete Trainingsergebnisse teilen", "Поделиться сопоставленными результатами тренировки", "Partager les résultats d’entraînement associés"],
  ["No workout data matches this range and filter yet.", "لا توجد بيانات تمرين تطابق هذا النطاق وعامل التصفية بعد.", "Aún no hay datos de entrenamiento que coincidan con este intervalo y filtro.", "尚无符合此范围和筛选条件的锻炼数据。", "Ingen träningsdata matchar ännu intervallet och filtret.", "Für diesen Zeitraum und Filter liegen noch keine passenden Trainingsdaten vor.", "Для этого диапазона и фильтра пока нет данных тренировки.", "Aucune donnée d’entraînement ne correspond encore à cette période et à ce filtre."],
  ["Automatic target", "\u0627\u0644\u0647\u062f\u0641 \u0627\u0644\u062a\u0644\u0642\u0627\u0626\u064a", "Objetivo autom\u00e1tico", "\u81ea\u52a8\u76ee\u6807", "Automatiskt m\u00e5l", "Automatisches Ziel", "\u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0430\u044f \u0446\u0435\u043b\u044c", "Objectif automatique"],
  ["Calculate with", "\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062d\u0633\u0627\u0628", "Calcular con", "\u8ba1\u7b97\u65b9\u5f0f", "Ber\u00e4kna med", "Berechnen mit", "\u041c\u0435\u0442\u043e\u0434 \u0440\u0430\u0441\u0447\u0451\u0442\u0430", "Calculer avec"],
  ["History", "\u0627\u0644\u0633\u062c\u0644", "Historial", "\u5386\u53f2\u8bb0\u5f55", "Historik", "Verlauf", "\u0418\u0441\u0442\u043e\u0440\u0438\u044f", "Historique"],
  ["Average", "\u0627\u0644\u0645\u062a\u0648\u0633\u0637", "Promedio", "\u5e73\u5747\u503c", "Genomsnitt", "Durchschnitt", "\u0421\u0440\u0435\u0434\u043d\u0435\u0435", "Moyenne"],
  ["Median", "\u0627\u0644\u0648\u0633\u064a\u0637", "Mediana", "\u4e2d\u4f4d\u6570", "Median", "Median", "\u041c\u0435\u0434\u0438\u0430\u043d\u0430", "M\u00e9diane"],
  ["Previous week", "\u0627\u0644\u0623\u0633\u0628\u0648\u0639 \u0627\u0644\u0633\u0627\u0628\u0642", "Semana anterior", "\u4e0a\u4e00\u5468", "F\u00f6reg\u00e5ende vecka", "Vorherige Woche", "\u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0430\u044f \u043d\u0435\u0434\u0435\u043b\u044f", "Semaine pr\u00e9c\u00e9dente"],
  ["Previous month", "\u0627\u0644\u0634\u0647\u0631 \u0627\u0644\u0633\u0627\u0628\u0642", "Mes anterior", "\u4e0a\u4e2a\u6708", "F\u00f6reg\u00e5ende m\u00e5nad", "Vorheriger Monat", "\u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0439 \u043c\u0435\u0441\u044f\u0446", "Mois pr\u00e9c\u00e9dent"],
  ["Previous year", "\u0627\u0644\u0633\u0646\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629", "A\u00f1o anterior", "\u53bb\u5e74", "F\u00f6reg\u00e5ende \u00e5r", "Vorheriges Jahr", "\u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0439 \u0433\u043e\u0434", "Ann\u00e9e pr\u00e9c\u00e9dente"],
  ["All earlier data", "\u0643\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0633\u0627\u0628\u0642\u0629", "Todos los datos anteriores", "\u6240\u6709\u65e9\u671f\u6570\u636e", "Alla tidigare data", "Alle fr\u00fcheren Daten", "\u0412\u0441\u0435 \u043f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0435 \u0434\u0430\u043d\u043d\u044b\u0435", "Toutes les donn\u00e9es ant\u00e9rieures"],
  ["Use your own completed history. The manual target remains the fallback when no earlier data is available.", "\u0627\u0633\u062a\u062e\u062f\u0645 \u0633\u062c\u0644\u0643 \u0627\u0644\u0645\u0643\u062a\u0645\u0644. \u064a\u0628\u0642\u0649 \u0627\u0644\u0647\u062f\u0641 \u0627\u0644\u064a\u062f\u0648\u064a \u0647\u0648 \u0627\u0644\u0628\u062f\u064a\u0644 \u0639\u0646\u062f \u0639\u062f\u0645 \u062a\u0648\u0641\u0631 \u0628\u064a\u0627\u0646\u0627\u062a \u0633\u0627\u0628\u0642\u0629.", "Usa tu historial completado. El objetivo manual se utiliza si no hay datos anteriores.", "\u4f7f\u7528\u4f60\u5df2\u5b8c\u6210\u7684\u5386\u53f2\u8bb0\u5f55\u3002\u6ca1\u6709\u66f4\u65e9\u6570\u636e\u65f6\u4f7f\u7528\u624b\u52a8\u76ee\u6807\u3002", "Anv\u00e4nd din slutf\u00f6rda historik. Det manuella m\u00e5let anv\u00e4nds n\u00e4r tidigare data saknas.", "Verwende deinen abgeschlossenen Verlauf. Das manuelle Ziel gilt, wenn keine fr\u00fcheren Daten vorhanden sind.", "\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u0443\u044e \u0438\u0441\u0442\u043e\u0440\u0438\u044e. \u0415\u0441\u043b\u0438 \u0431\u043e\u043b\u0435\u0435 \u0440\u0430\u043d\u043d\u0438\u0445 \u0434\u0430\u043d\u043d\u044b\u0445 \u043d\u0435\u0442, \u043f\u0440\u0438\u043c\u0435\u043d\u044f\u0435\u0442\u0441\u044f \u0437\u0430\u0434\u0430\u043d\u043d\u0430\u044f \u0432\u0440\u0443\u0447\u043d\u0443\u044e \u0446\u0435\u043b\u044c.", "Utilisez votre historique termin\u00e9. L\u2019objectif manuel est utilis\u00e9 si aucune donn\u00e9e ant\u00e9rieure n\u2019est disponible."],
  ["Week, month and year use the last fully completed calendar period.", "\u064a\u0633\u062a\u062e\u062f\u0645 \u0627\u0644\u0623\u0633\u0628\u0648\u0639 \u0648\u0627\u0644\u0634\u0647\u0631 \u0648\u0627\u0644\u0633\u0646\u0629 \u0622\u062e\u0631 \u0641\u062a\u0631\u0629 \u062a\u0642\u0648\u064a\u0645\u064a\u0629 \u0645\u0643\u062a\u0645\u0644\u0629.", "La semana, el mes y el a\u00f1o usan el \u00faltimo periodo natural completado.", "\u5468\u3001\u6708\u548c\u5e74\u4f7f\u7528\u6700\u8fd1\u5b8c\u6574\u7ed3\u675f\u7684\u65e5\u5386\u5468\u671f\u3002", "Vecka, m\u00e5nad och \u00e5r anv\u00e4nder den senast avslutade kalenderperioden.", "Woche, Monat und Jahr verwenden den letzten vollst\u00e4ndig abgeschlossenen Kalenderzeitraum.", "\u0414\u043b\u044f \u043d\u0435\u0434\u0435\u043b\u0438, \u043c\u0435\u0441\u044f\u0446\u0430 \u0438 \u0433\u043e\u0434\u0430 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u043f\u043e\u043b\u043d\u043e\u0441\u0442\u044c\u044e \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u044b\u0439 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u043d\u044b\u0439 \u043f\u0435\u0440\u0438\u043e\u0434.", "La semaine, le mois et l\u2019ann\u00e9e utilisent la derni\u00e8re p\u00e9riode calendaire enti\u00e8rement termin\u00e9e."],
  ["Circle", "دائرة", "Círculo", "圆形", "Cirkel", "Kreis", "Круг", "Cercle"],
  ["Square", "مربع", "Cuadrado", "方形", "Fyrkant", "Quadrat", "Квадрат", "Carré"],
  ["Lightning", "برق", "Relámpago", "闪电", "Blixt", "Blitz", "Молния", "Éclair"],
  ["Smiley", "وجه مبتسم", "Sonrisa", "笑脸", "Leende", "Smiley", "Смайлик", "Sourire"],
  ["Beer", "بيرة", "Cerveza", "啤酒", "Öl", "Bier", "Пиво", "Bière"],
  ["Coffee", "قهوة", "Café", "咖啡", "Kaffe", "Kaffee", "Кофе", "Café"],
  ["Heart", "قلب", "Corazón", "爱心", "Hjärta", "Herz", "Сердце", "Cœur"],
  ["Star", "نجمة", "Estrella", "星星", "Stjärna", "Stern", "Звезда", "Étoile"],
  ["Shield", "درع", "Escudo", "盾牌", "Sköld", "Schild", "Щит", "Bouclier"],
  ["Flame", "لهب", "Llama", "火焰", "Flamma", "Flamme", "Пламя", "Flamme"],
  ["Rocket", "صاروخ", "Cohete", "火箭", "Raket", "Rakete", "Ракета", "Fusée"],
  ["Leaf", "ورقة", "Hoja", "叶子", "Löv", "Blatt", "Лист", "Feuille"],
  ["Trophy", "كأس", "Trofeo", "奖杯", "Pokal", "Pokal", "Кубок", "Trophée"],
  ["Diamond", "ماسة", "Diamante", "钻石", "Diamant", "Diamant", "Алмаз", "Diamant"],
  ["Orbit", "مدار", "Órbita", "轨道", "Omloppsbana", "Umlaufbahn", "Орбита", "Orbite"],
  ["Strength", "قوة", "Fuerza", "力量", "Styrka", "Stärke", "Сила", "Force"],
  ["Medal", "ميدالية", "Medalla", "奖牌", "Medalj", "Medaille", "Медаль", "Médaille"],
  ["Compass", "بوصلة", "Brújula", "指南针", "Kompass", "Kompass", "Компас", "Boussole"],
  ["Water drop", "قطرة ماء", "Gota de agua", "水滴", "Vattendroppe", "Wassertropfen", "Капля воды", "Goutte d’eau"],
  ["Sparkles", "بريق", "Destellos", "闪光", "Gnistor", "Funkeln", "Искры", "Étincelles"],
  ["Dismiss sign-in error", "إغلاق خطأ تسجيل الدخول", "Cerrar el error de inicio de sesión", "关闭登录错误", "Stäng inloggningsfelet", "Anmeldefehler schließen", "Закрыть ошибку входа", "Fermer l’erreur de connexion"],
  ["Loading your HabHub data...", "جارٍ تحميل بيانات HabHub...", "Cargando tus datos de HabHub...", "正在加载你的 HabHub 数据...", "Laddar dina HabHub-data...", "Deine HabHub-Daten werden geladen...", "Загрузка ваших данных HabHub...", "Chargement de vos données HabHub..."],
] satisfies readonly TranslationRow[];

const templateTranslationRows = [
  ["Select a day from the {value} year grid", "اختر يومًا من شبكة السنة لـ {value}", "Selecciona un día de la cuadrícula anual de {value}", "从 {value} 年度网格中选择一天", "Välj en dag i årsöversikten för {value}", "Wähle einen Tag im Jahresraster für {value} aus", "Выберите день в годовой сетке для {value}", "Sélectionnez un jour dans la grille annuelle de {value}"],
  ["Edit {name}", "تعديل {name}", "Editar {name}", "编辑{name}", "Redigera {name}", "{name} bearbeiten", "Изменить {name}", "Modifier {name}"],
  ["Delete {name}?", "حذف {name}؟", "¿Eliminar {name}?", "删除{name}？", "Radera {name}?", "{name} löschen?", "Удалить {name}?", "Supprimer {name} ?"],
  ["Add {name}", "إضافة {name}", "Añadir {name}", "添加{name}", "Lägg till {name}", "{name} hinzufügen", "Добавить {name}", "Ajouter {name}"],
  ["Open {name}", "فتح {name}", "Abrir {name}", "打开{name}", "Öppna {name}", "{name} öffnen", "Открыть {name}", "Ouvrir {name}"],
  ["Confirm {name} log", "تأكيد سجل {name}", "Confirmar registro de {name}", "确认{name}记录", "Bekräfta {name}-logg", "{name}-Eintrag bestätigen", "Подтвердить запись {name}", "Confirmer le journal de {name}"],
  ["{count} days", "{count} أيام", "{count} días", "{count}天", "{count} dagar", "{count} Tage", "{count} дн.", "{count} jours"],
  ["{count} min", "{count} دقيقة", "{count} min", "{count}分钟", "{count} min", "{count} Min.", "{count} мин", "{count} min"],
  ["Target {value}", "الهدف {value}", "Objetivo {value}", "目标 {value}", "Mål {value}", "Ziel {value}", "Цель {value}", "Objectif {value}"],
  ["Welcome, {name}", "مرحبًا، {name}", "Hola, {name}", "欢迎，{name}", "Välkommen, {name}", "Willkommen, {name}", "Добро пожаловать, {name}", "Bienvenue, {name}"],
  ["{name}'s badge showcase", "واجهة شارات {name}", "Vitrina de insignias de {name}", "{name}的徽章展示", "{name}s märkessamling", "{name}s Abzeichen", "Витрина наград {name}", "Vitrine de badges de {name}"],
] satisfies readonly TranslationRow[];

const allTranslationRows = [
  ...commonTranslationRows,
  ...templateTranslationRows,
] as const;

const commonCatalogs = Object.fromEntries(
  secondaryLanguages.map((language, languageIndex) => [
    language,
    Object.fromEntries(
      allTranslationRows.map((row) => [row[0], row[languageIndex + 1]]),
    ),
  ]),
) as Record<SecondaryLanguage, Record<string, string>>;

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const templateSources = [
  ...new Set([
    ...templateTranslationRows.map(([source]) => source),
    ...Object.keys(generatedCatalogs.ar).filter(
      (source) =>
        /\{[^}]+\}/.test(source) &&
        /\p{L}/u.test(source.replace(/\{[^}]+\}/g, "")),
    ),
  ]),
].sort(
  (left, right) =>
    right.replace(/\{[^}]+\}/g, "").length -
    left.replace(/\{[^}]+\}/g, "").length,
);

const templateMatchers = templateSources.map((source) => {
  const parts = source.split(/\{[^}]+\}/g).map(escapeRegularExpression);
  return {
    source,
    parameterNames: [...source.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    ),
    expression: new RegExp(`^${parts.join("(.+?)")}$`, "s"),
  };
});

export function isAppLanguage(value: unknown): value is AppLanguage {
  return supportedLanguages.some((item) => item.id === value);
}

export function normalizeAppLanguage(value: unknown): AppLanguage {
  return isAppLanguage(value) ? value : "en";
}

export function translateUiText(language: AppLanguage, source: string) {
  if (language === "en" || !source) return source;
  const match = /^(\s*)(.*?)(\s*)$/s.exec(source);
  if (!match) return source;
  const [, before, content, after] = match;
  const direct =
    commonCatalogs[language][content] ??
    catalogs[language][content];
  if (direct) return `${before}${direct}${after}`;

  // Curated domain vocabulary and patterns take priority over the generated
  // fallback. This is especially important for health abbreviations and
  // exercise names, where generic machine translation can change the meaning.
  const domain = translateDomainText(language, content);
  if (domain !== content) return `${before}${domain}${after}`;

  const generatedDirect = generatedCatalogs[language][content];
  if (generatedDirect) return `${before}${generatedDirect}${after}`;

  for (const matcher of templateMatchers) {
    const values = matcher.expression.exec(content);
    if (!values) continue;
    const translatedTemplate =
      commonCatalogs[language][matcher.source] ??
      catalogs[language][matcher.source] ??
      generatedCatalogs[language][matcher.source];
    if (!translatedTemplate) continue;
    const parameters = new Map(
      matcher.parameterNames.map((name, index) => [name, values[index + 1] ?? ""]),
    );
    const translated = translatedTemplate.replace(
      /\{([^}]+)\}/g,
      (_placeholder, name: string) => parameters.get(name) ?? "",
    );
    return `${before}${translated}${after}`;
  }
  return source;
}

type LocalizationValue = {
  language: AppLanguage;
  locale: string;
  isRtl: boolean;
  t: (source: string) => string;
};

const LocalizationContext = createContext<LocalizationValue>({
  language: "en",
  locale: appLocales.en,
  isRtl: false,
  t: (source) => source,
});

let activeAlertLanguage: AppLanguage = "en";

function showLocalizedAlert(
  language: AppLanguage,
  title: string,
  message?: string,
  buttons?: Parameters<typeof Alert.alert>[2],
  options?: Parameters<typeof Alert.alert>[3],
) {
  const t = (source: string) => translateUiText(language, source);
  const localizedTitle = t(title);
  const localizedMessage = message ? t(message) : message;
  const localizedButtons = buttons?.map((button) => ({
      ...button,
      text: button.text ? t(button.text) : button.text,
    }));
  if (Platform.OS === "web")
    return showWebAlert(
      localizedTitle,
      localizedMessage,
      localizedButtons,
      options,
    );
  return Alert.alert(localizedTitle, localizedMessage, localizedButtons, options);
}

/**
 * Drop-in React Native Alert replacement for code that cannot use hooks.
 * The single app-level provider updates its language before children render.
 */
export const LocalizedAlert = {
  alert(
    title: string,
    message?: string,
    buttons?: Parameters<typeof Alert.alert>[2],
    options?: Parameters<typeof Alert.alert>[3],
  ) {
    return showLocalizedAlert(
      activeAlertLanguage,
      title,
      message,
      buttons,
      options,
    );
  },
};

export function LocalizationProvider({
  language,
  children,
}: PropsWithChildren<{ language?: AppLanguage }>) {
  const normalized = normalizeAppLanguage(language);
  activeAlertLanguage = normalized;
  const t = useCallback(
    (source: string) => translateUiText(normalized, source),
    [normalized],
  );
  const value = useMemo(
    () => ({
      language: normalized,
      locale: appLocales[normalized],
      isRtl: normalized === "ar",
      t,
    }),
    [normalized, t],
  );
  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization() {
  return useContext(LocalizationContext);
}

export function useTranslation() {
  return useLocalization().t;
}

/** BCP-47 locale selected in app settings, independent of the device locale. */
export function useLocale() {
  return useLocalization().locale;
}

/** Localizes known interface alert copy while preserving callbacks and options. */
export function useLocalizedAlert() {
  const { language } = useLocalization();
  return useCallback(
    (
      title: string,
      message?: string,
      buttons?: Parameters<typeof Alert.alert>[2],
      options?: Parameters<typeof Alert.alert>[3],
    ) => showLocalizedAlert(language, title, message, buttons, options),
    [language],
  );
}
