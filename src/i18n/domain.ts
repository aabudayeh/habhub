import { AppLanguage, MetricDefinition, MetricSubmetric, MuscleGroup } from "@/src/types";

type SecondaryLanguage = Exclude<AppLanguage, "en">;
type Row = readonly [string, string, string, string, string, string, string, string];

const languages: readonly SecondaryLanguage[] = [
  "ar",
  "es",
  "zh-Hans",
  "sv",
  "de",
  "ru",
  "fr",
];

/**
 * App-owned health, activity and achievement vocabulary. These entries are
 * deliberately separate from the UI catalog: only recognized built-ins are
 * translated, while user-created tracker/exercise names stay untouched.
 */
const termRows = [
  ["Screen time", "وقت الشاشة", "Tiempo de pantalla", "屏幕使用时间", "Skärmtid", "Bildschirmzeit", "Экранное время", "Temps d’écran"],
  ["Steps", "الخطوات", "Pasos", "步数", "Steg", "Schritte", "Шаги", "Pas"],
  ["Food", "الطعام", "Alimentación", "饮食", "Mat", "Ernährung", "Питание", "Alimentation"],
  ["Active energy", "الطاقة النشطة", "Energía activa", "活动能量", "Aktiv energi", "Aktive Energie", "Активная энергия", "Énergie active"],
  ["Daily deficit", "العجز اليومي", "Déficit diario", "每日热量缺口", "Dagligt underskott", "Tägliches Defizit", "Дневной дефицит", "Déficit quotidien"],
  ["Daily surplus", "الفائض اليومي", "Superávit diario", "每日热量盈余", "Dagligt överskott", "Täglicher Überschuss", "Дневной профицит", "Surplus quotidien"],
  ["Energy balance", "توازن الطاقة", "Balance energético", "能量平衡", "Energibalans", "Energiebilanz", "Энергетический баланс", "Bilan énergétique"],
  ["Water", "الماء", "Agua", "饮水", "Vatten", "Wasser", "Вода", "Eau"],
  ["Workout", "التمرين", "Entrenamiento", "锻炼", "Träning", "Training", "Тренировка", "Entraînement"],
  ["Weight", "الوزن", "Peso", "体重", "Vikt", "Gewicht", "Вес", "Poids"],
  ["Protein", "البروتين", "Proteína", "蛋白质", "Protein", "Eiweiß", "Белок", "Protéines"],
  ["Fat", "الدهون", "Grasas", "脂肪", "Fett", "Fett", "Жиры", "Lipides"],
  ["Carbs", "الكربوهيدرات", "Carbohidratos", "碳水化合物", "Kolhydrater", "Kohlenhydrate", "Углеводы", "Glucides"],
  ["Fiber", "الألياف", "Fibra", "膳食纤维", "Fiber", "Ballaststoffe", "Клетчатка", "Fibres"],
  ["Sodium", "الصوديوم", "Sodio", "钠", "Natrium", "Natrium", "Натрий", "Sodium"],
  ["Progress photo", "صورة التقدم", "Foto de progreso", "进度照片", "Framstegsfoto", "Fortschrittsfoto", "Фото прогресса", "Photo de progression"],
  ["Workout duration", "مدة التمرين", "Duración del entrenamiento", "锻炼时长", "Träningstid", "Trainingsdauer", "Длительность тренировки", "Durée de l’entraînement"],
  ["Body fat", "دهون الجسم", "Grasa corporal", "体脂", "Kroppsfett", "Körperfett", "Жир в организме", "Masse grasse"],
  ["Lean body mass", "كتلة الجسم الخالية من الدهون", "Masa corporal magra", "瘦体重", "Fettfri kroppsmassa", "Fettfreie Körpermasse", "Безжировая масса тела", "Masse maigre"],
  ["Body water mass", "كتلة ماء الجسم", "Masa de agua corporal", "身体水分质量", "Kroppsvattenmassa", "Körperwassermasse", "Масса воды в организме", "Masse hydrique corporelle"],
  ["Bone mass", "كتلة العظام", "Masa ósea", "骨量", "Benmassa", "Knochenmasse", "Костная масса", "Masse osseuse"],
  ["Blood pressure", "ضغط الدم", "Presión arterial", "血压", "Blodtryck", "Blutdruck", "Артериальное давление", "Tension artérielle"],
  ["Systolic", "الانقباضي", "Sistólica", "收缩压", "Systoliskt", "Systolisch", "Систолическое", "Systolique"],
  ["Diastolic", "الانبساطي", "Diastólica", "舒张压", "Diastoliskt", "Diastolisch", "Диастолическое", "Diastolique"],
  ["Pulse", "النبض", "Pulso", "脉搏", "Puls", "Puls", "Пульс", "Pouls"],
  ["Blood pressure · diastolic", "ضغط الدم · الانبساطي", "Presión arterial · diastólica", "血压 · 舒张压", "Blodtryck · diastoliskt", "Blutdruck · diastolisch", "Давление · диастолическое", "Tension · diastolique"],
  ["Workout calories", "سعرات التمرين", "Calorías del entrenamiento", "锻炼热量", "Träningskalorier", "Trainingskalorien", "Калории тренировки", "Calories d’entraînement"],
  ["Workout distance", "مسافة التمرين", "Distancia del entrenamiento", "锻炼距离", "Träningssträcka", "Trainingsdistanz", "Дистанция тренировки", "Distance d’entraînement"],
  ["Sugar", "السكر", "Azúcar", "糖", "Socker", "Zucker", "Сахар", "Sucres"],
  ["Saturated fat", "الدهون المشبعة", "Grasas saturadas", "饱和脂肪", "Mättat fett", "Gesättigte Fettsäuren", "Насыщенные жиры", "Graisses saturées"],
  ["Cholesterol", "الكوليسترول", "Colesterol", "胆固醇", "Kolesterol", "Cholesterin", "Холестерин", "Cholestérol"],
  ["Potassium", "البوتاسيوم", "Potasio", "钾", "Kalium", "Kalium", "Калий", "Potassium"],
  ["Calcium", "الكالسيوم", "Calcio", "钙", "Kalcium", "Kalzium", "Кальций", "Calcium"],
  ["Iron", "الحديد", "Hierro", "铁", "Järn", "Eisen", "Железо", "Fer"],
  ["Magnesium", "المغنيسيوم", "Magnesio", "镁", "Magnesium", "Magnesium", "Магний", "Magnésium"],
  ["Vitamin C", "فيتامين C", "Vitamina C", "维生素 C", "Vitamin C", "Vitamin C", "Витамин C", "Vitamine C"],
  ["Vitamin D", "فيتامين D", "Vitamina D", "维生素 D", "Vitamin D", "Vitamin D", "Витамин D", "Vitamine D"],
  ["Vitamin B12", "فيتامين B12", "Vitamina B12", "维生素 B12", "Vitamin B12", "Vitamin B12", "Витамин B12", "Vitamine B12"],
  ["Weekly balance", "الرصيد الأسبوعي", "Balance semanal", "每周平衡", "Veckobalans", "Wochenbilanz", "Недельный баланс", "Bilan hebdomadaire"],
  ["Sleep", "النوم", "Sueño", "睡眠", "Sömn", "Schlaf", "Сон", "Sommeil"],
  ["Blood glucose", "سكر الدم", "Glucosa en sangre", "血糖", "Blodsocker", "Blutzucker", "Глюкоза крови", "Glycémie"],
  ["Cycle tracking", "تتبع الدورة", "Seguimiento del ciclo", "经期追踪", "Cykelspårning", "Zyklus-Tracking", "Отслеживание цикла", "Suivi du cycle"],
  ["Period flow", "غزارة الدورة", "Flujo menstrual", "经量", "Mensflöde", "Menstruationsstärke", "Интенсивность менструации", "Flux menstruel"],
  ["Cycle symptoms", "أعراض الدورة", "Síntomas del ciclo", "周期症状", "Cykelsymtom", "Zyklussymptome", "Симптомы цикла", "Symptômes du cycle"],
  ["Cycle day", "يوم الدورة", "Día del ciclo", "周期日", "Cykeldag", "Zyklustag", "День цикла", "Jour du cycle"],
  ["Next period estimate", "تقدير موعد الدورة التالية", "Estimación del próximo periodo", "下次经期预测", "Beräknad nästa mens", "Schätzung der nächsten Periode", "Прогноз следующей менструации", "Estimation des prochaines règles"],
  ["Overall score", "النتيجة الإجمالية", "Puntuación total", "综合得分", "Totalpoäng", "Gesamtpunktzahl", "Общий балл", "Score global"],
  ["To-Dos", "المهام", "Tareas", "待办事项", "Att göra", "Aufgaben", "Задачи", "Tâches"],
  ["Gym completed", "اكتمل تمرين النادي", "Gimnasio completado", "健身已完成", "Gympass klart", "Training abgeschlossen", "Тренировка в зале выполнена", "Séance terminée"],
  ["Gym duration", "مدة تمرين النادي", "Duración en el gimnasio", "健身时长", "Gymtid", "Trainingsdauer im Studio", "Время в зале", "Durée en salle"],
  ["Gym volume", "حجم تمرين النادي", "Volumen de entrenamiento", "训练容量", "Träningsvolym", "Trainingsvolumen", "Объём тренировки", "Volume d’entraînement"],
  ["Completed gym sets", "مجموعات التمرين المكتملة", "Series completadas", "已完成组数", "Slutförda set", "Abgeschlossene Sätze", "Выполненные подходы", "Séries terminées"],
  ["Workout completed", "اكتمل التمرين", "Entrenamiento completado", "锻炼已完成", "Träning klar", "Training abgeschlossen", "Тренировка выполнена", "Entraînement terminé"],
  ["Workout volume", "حجم التمرين", "Volumen de entrenamiento", "训练容量", "Träningsvolym", "Trainingsvolumen", "Объём тренировки", "Volume d’entraînement"],
  ["Completed workout sets", "مجموعات التمرين المكتملة", "Series de entrenamiento completadas", "已完成训练组数", "Slutförda träningsset", "Abgeschlossene Trainingssätze", "Выполненные подходы", "Séries d’entraînement terminées"],
  ["Goals", "الأهداف", "Objetivos", "目标", "Mål", "Ziele", "Цели", "Objectifs"],
  ["Activity", "النشاط", "Actividad", "活动", "Aktivitet", "Aktivität", "Активность", "Activité"],
  ["Food & nutrition", "الطعام والتغذية", "Alimentación y nutrición", "饮食与营养", "Mat och näring", "Ernährung", "Питание", "Alimentation et nutrition"],
  ["Body composition", "تكوين الجسم", "Composición corporal", "身体成分", "Kroppssammansättning", "Körperzusammensetzung", "Состав тела", "Composition corporelle"],
  ["Health readings", "القياسات الصحية", "Mediciones de salud", "健康读数", "Hälsovärden", "Gesundheitswerte", "Показатели здоровья", "Mesures de santé"],
  ["Mind & focus", "الذهن والتركيز", "Mente y concentración", "专注与思维", "Fokus och sinne", "Geist und Fokus", "Разум и концентрация", "Esprit et concentration"],
  ["Photos", "الصور", "Fotos", "照片", "Foton", "Fotos", "Фотографии", "Photos"],
  ["Other", "أخرى", "Otros", "其他", "Övrigt", "Sonstiges", "Другое", "Autre"],
  ["Chest", "الصدر", "Pecho", "胸部", "Bröst", "Brust", "Грудь", "Pectoraux"],
  ["Back", "الظهر", "Espalda", "背部", "Rygg", "Rücken", "Спина", "Dos"],
  ["Shoulders", "الكتفان", "Hombros", "肩部", "Axlar", "Schultern", "Плечи", "Épaules"],
  ["Biceps", "العضلة ذات الرأسين", "Bíceps", "肱二头肌", "Biceps", "Bizeps", "Бицепс", "Biceps"],
  ["Triceps", "العضلة ثلاثية الرؤوس", "Tríceps", "肱三头肌", "Triceps", "Trizeps", "Трицепс", "Triceps"],
  ["Forearms", "الساعدان", "Antebrazos", "前臂", "Underarmar", "Unterarme", "Предплечья", "Avant-bras"],
  ["Core / abs", "الجذع / البطن", "Core / abdominales", "核心 / 腹肌", "Bål / mage", "Rumpf / Bauch", "Кор / пресс", "Ceinture abdominale"],
  ["Glutes", "الأرداف", "Glúteos", "臀肌", "Säte", "Gesäß", "Ягодицы", "Fessiers"],
  ["Quadriceps", "العضلات رباعية الرؤوس", "Cuádriceps", "股四头肌", "Framsida lår", "Quadrizeps", "Квадрицепс", "Quadriceps"],
  ["Hamstrings", "أوتار الركبة", "Isquiotibiales", "腘绳肌", "Baksida lår", "Beinbeuger", "Задняя поверхность бедра", "Ischio-jambiers"],
  ["Calves", "ربلة الساق", "Pantorrillas", "小腿", "Vader", "Waden", "Икры", "Mollets"],
  ["Full body", "الجسم بالكامل", "Cuerpo completo", "全身", "Helkropp", "Ganzkörper", "Всё тело", "Corps entier"],
  ["steps", "خطوة", "pasos", "步", "steg", "Schritte", "шагов", "pas"],
  ["kcal", "سعرة حرارية", "kcal", "千卡", "kcal", "kcal", "ккал", "kcal"],
  ["L", "لتر", "l", "升", "l", "l", "л", "l"],
  ["kg", "كغ", "kg", "千克", "kg", "kg", "кг", "kg"],
  ["g", "غ", "g", "克", "g", "g", "г", "g"],
  ["mg", "ملغ", "mg", "毫克", "mg", "mg", "мг", "mg"],
  ["mcg", "ميكروغرام", "μg", "微克", "µg", "µg", "мкг", "µg"],
  ["min", "دقيقة", "min", "分钟", "min", "Min.", "мин", "min"],
  ["hr", "ساعة", "h", "小时", "tim", "Std.", "ч", "h"],
  ["mmHg", "مم زئبق", "mmHg", "毫米汞柱", "mmHg", "mmHg", "мм рт. ст.", "mmHg"],
  ["bpm", "نبضة/دقيقة", "lpm", "次/分", "slag/min", "Schläge/min", "уд/мин", "bpm"],
  ["km", "كم", "km", "公里", "km", "km", "км", "km"],
  ["mg/dL", "ملغ/ديسيلتر", "mg/dl", "毫克/分升", "mg/dl", "mg/dl", "мг/дл", "mg/dl"],
  ["day", "يوم", "día", "天", "dag", "Tag", "день", "jour"],
  ["days", "أيام", "días", "天", "dagar", "Tage", "дней", "jours"],
  ["pts", "نقطة", "ptos.", "分", "p", "Pkt.", "балл.", "pts"],
  ["sets", "مجموعات", "series", "组", "set", "Sätze", "подходов", "séries"],
  ["reps", "تكرارات", "repeticiones", "次", "reps", "Wdh.", "повторений", "répétitions"],
  ["s", "ث", "s", "秒", "s", "Sek.", "с", "s"],
  ["ml", "مل", "ml", "毫升", "ml", "ml", "мл", "ml"],
  ["kg e1RM", "كغ 1RM تقديري", "kg 1RM estimada", "千克 估算1RM", "kg beräknad 1RM", "kg geschätztes 1RM", "кг расч. 1ПМ", "kg 1RM estimée"],
  ["strength", "القوة", "fuerza", "力量", "styrka", "Kraft", "сила", "force"],
  ["volume", "الحجم", "volumen", "训练容量", "volym", "Volumen", "объём", "volume"],
  ["Reading", "القراءة", "Lectura", "阅读", "Läsning", "Lesen", "Чтение", "Lecture"],
  ["Study", "الدراسة", "Estudio", "学习", "Studier", "Lernen", "Учёба", "Étude"],
  ["Work", "العمل", "Trabajo", "工作", "Arbete", "Arbeit", "Работа", "Travail"],
] satisfies readonly Row[];

const exerciseRows = [
  ["Barbell bench press", "ضغط صدر بالبار", "Press de banca con barra", "杠铃卧推", "Bänkpress med skivstång", "Bankdrücken mit Langhantel", "Жим штанги лёжа", "Développé couché à la barre"],
  ["Dumbbell bench press", "ضغط صدر بالدمبل", "Press de banca con mancuernas", "哑铃卧推", "Bänkpress med hantlar", "Kurzhantel-Bankdrücken", "Жим гантелей лёжа", "Développé couché aux haltères"],
  ["Incline bench press", "ضغط صدر مائل", "Press de banca inclinado", "上斜卧推", "Lutande bänkpress", "Schrägbankdrücken", "Жим на наклонной скамье", "Développé incliné"],
  ["Chest fly", "تفتيح صدر", "Aperturas de pecho", "飞鸟夹胸", "Bröstflyes", "Butterfly", "Разведение рук на грудь", "Écarté pectoral"],
  ["Push-up", "تمرين الضغط", "Flexión", "俯卧撑", "Armhävning", "Liegestütz", "Отжимание", "Pompe"],
  ["Overhead press", "ضغط فوق الرأس", "Press militar", "推举", "Axelpress", "Überkopfdrücken", "Жим над головой", "Développé militaire"],
  ["Dumbbell shoulder press", "ضغط كتف بالدمبل", "Press de hombros con mancuernas", "哑铃肩推", "Axelpress med hantlar", "Kurzhantel-Schulterdrücken", "Жим гантелей над головой", "Développé épaules aux haltères"],
  ["Lateral raise", "رفع جانبي", "Elevación lateral", "侧平举", "Sidolyft", "Seitheben", "Подъём гантелей в стороны", "Élévation latérale"],
  ["Rear-delt fly", "تفتيح الكتف الخلفي", "Pájaros para deltoide posterior", "反向飞鸟", "Omvända flyes", "Reverse Fly", "Разведение на заднюю дельту", "Oiseau pour deltoïdes postérieurs"],
  ["Triceps pushdown", "دفع الترايسبس لأسفل", "Extensión de tríceps en polea", "绳索下压", "Tricepspress", "Trizepsdrücken", "Разгибание рук на блоке", "Extension triceps à la poulie"],
  ["Skull crusher", "تمديد ترايسبس مستلقياً", "Press francés tumbado", "仰卧臂屈伸", "Liggande tricepsextension", "French Press liegend", "Французский жим", "Barre au front"],
  ["Deadlift", "الرفعة الميتة", "Peso muerto", "硬拉", "Marklyft", "Kreuzheben", "Становая тяга", "Soulevé de terre"],
  ["Romanian deadlift", "الرفعة الرومانية", "Peso muerto rumano", "罗马尼亚硬拉", "Rumänska marklyft", "Rumänisches Kreuzheben", "Румынская тяга", "Soulevé de terre roumain"],
  ["Barbell row", "تجديف بالبار", "Remo con barra", "杠铃划船", "Skivstångsrodd", "Langhantelrudern", "Тяга штанги в наклоне", "Rowing barre"],
  ["Seated cable row", "تجديف بالكابل جلوساً", "Remo sentado en polea", "坐姿绳索划船", "Sittande kabelrodd", "Kabelrudern sitzend", "Тяга горизонтального блока", "Rowing assis à la poulie"],
  ["Lat pulldown", "سحب علوي", "Jalón al pecho", "高位下拉", "Latsdrag", "Latzug", "Тяга верхнего блока", "Tirage vertical"],
  ["Pull-up / chin-up", "عقلة / سحب", "Dominada pronada / supina", "引体向上", "Chins / pull-ups", "Klimmzug", "Подтягивание", "Traction"],
  ["Face pull", "سحب للوجه", "Face pull", "面拉", "Face pulls", "Face Pull", "Тяга к лицу", "Face pull"],
  ["Barbell curl", "بايسبس بالبار", "Curl con barra", "杠铃弯举", "Bicepscurl med skivstång", "Langhantelcurl", "Сгибание рук со штангой", "Curl à la barre"],
  ["Dumbbell curl", "بايسبس بالدمبل", "Curl con mancuernas", "哑铃弯举", "Bicepscurl med hantlar", "Kurzhantelcurl", "Сгибание рук с гантелями", "Curl avec haltères"],
  ["Hammer curl", "بايسبس قبضة المطرقة", "Curl martillo", "锤式弯举", "Hammercurl", "Hammercurl", "Молотковые сгибания", "Curl marteau"],
  ["Back squat", "سكوات خلفي", "Sentadilla trasera", "杠铃后蹲", "Knäböj", "Kniebeuge hinten", "Присед со штангой", "Squat arrière"],
  ["Front squat", "سكوات أمامي", "Sentadilla frontal", "前蹲", "Frontböj", "Frontkniebeuge", "Фронтальный присед", "Squat avant"],
  ["Leg press", "ضغط الأرجل", "Prensa de piernas", "腿举", "Benpress", "Beinpresse", "Жим ногами", "Presse à cuisses"],
  ["Leg extension", "تمديد الأرجل", "Extensión de piernas", "腿屈伸", "Benspark", "Beinstrecken", "Разгибание ног", "Extension de jambes"],
  ["Leg curl", "ثني الأرجل", "Curl femoral", "腿弯举", "Lårcurl", "Beinbeugen", "Сгибание ног", "Leg curl"],
  ["Walking lunge", "اندفاع بالمشي", "Zancada caminando", "行走弓步", "Gående utfall", "Gehende Ausfallschritte", "Выпады в ходьбе", "Fentes marchées"],
  ["Hip thrust", "دفع الورك", "Hip thrust", "臀推", "Höftlyft", "Hip Thrust", "Ягодичный мост со штангой", "Hip thrust"],
  ["Calf raise", "رفع السمانة", "Elevación de gemelos", "提踵", "Vadpress", "Wadenheben", "Подъём на носки", "Élévation des mollets"],
  ["Plank", "بلانك", "Plancha", "平板支撑", "Planka", "Unterarmstütz", "Планка", "Gainage"],
  ["Cable crunch", "كرنش بالكابل", "Crunch en polea", "绳索卷腹", "Kabelcrunch", "Kabel-Crunch", "Скручивания на блоке", "Crunch à la poulie"],
  ["Hanging leg raise", "رفع الأرجل معلقاً", "Elevación de piernas colgado", "悬垂举腿", "Hängande benlyft", "Hängendes Beinheben", "Подъём ног в висе", "Relevé de jambes suspendu"],
  ["Farmer carry", "مشي المزارع", "Paseo del granjero", "农夫行走", "Farmers walk", "Farmer’s Walk", "Прогулка фермера", "Marche du fermier"],
  ["Kettlebell swing", "مرجحة الكيتل بيل", "Swing con kettlebell", "壶铃摆动", "Kettlebellsving", "Kettlebell Swing", "Махи гирей", "Swing kettlebell"],
  ["Decline bench press", "ضغط صدر منخفض", "Press de banca declinado", "下斜卧推", "Nedåtlutande bänkpress", "Negativ-Bankdrücken", "Жим на наклонной вниз", "Développé décliné"],
  ["Incline dumbbell press", "ضغط دمبل مائل", "Press inclinado con mancuernas", "上斜哑铃卧推", "Lutande hantelpress", "Schrägbankdrücken mit Kurzhanteln", "Жим гантелей на наклонной", "Développé incliné aux haltères"],
  ["Cable fly", "تفتيح بالكابل", "Aperturas en polea", "绳索飞鸟", "Kabelflyes", "Kabel-Flys", "Сведение рук в кроссовере", "Écarté à la poulie"],
  ["Chest dip", "متوازي للصدر", "Fondos para pecho", "双杠臂屈伸（胸）", "Dips för bröst", "Dips für die Brust", "Отжимания на брусьях", "Dips pectoraux"],
  ["Arnold press", "ضغط أرنولد", "Press Arnold", "阿诺德推举", "Arnoldpress", "Arnold Press", "Жим Арнольда", "Développé Arnold"],
  ["Upright row", "تجديف واقف", "Remo al mentón", "直立划船", "Upprätt rodd", "Aufrechtes Rudern", "Тяга к подбородку", "Tirage menton"],
  ["Cable lateral raise", "رفع جانبي بالكابل", "Elevación lateral en polea", "绳索侧平举", "Sidolyft i kabel", "Seitheben am Kabel", "Подъём руки в сторону на блоке", "Élévation latérale à la poulie"],
  ["Close-grip bench press", "ضغط صدر بقبضة ضيقة", "Press de banca con agarre cerrado", "窄握卧推", "Smal bänkpress", "Enges Bankdrücken", "Жим узким хватом", "Développé couché prise serrée"],
  ["Overhead triceps extension", "تمديد ترايسبس فوق الرأس", "Extensión de tríceps sobre la cabeza", "过顶臂屈伸", "Tricepsextension över huvudet", "Trizepsstrecken über Kopf", "Разгибание рук над головой", "Extension triceps au-dessus de la tête"],
  ["Assisted pull-up", "عقلة بمساعدة", "Dominada asistida", "辅助引体向上", "Assisterade chins", "Unterstützter Klimmzug", "Подтягивание с поддержкой", "Traction assistée"],
  ["Single-arm dumbbell row", "تجديف دمبل بذراع واحدة", "Remo con mancuerna a una mano", "单臂哑铃划船", "Enarms hantelrodd", "Einarmiges Kurzhantelrudern", "Тяга гантели одной рукой", "Rowing haltère à un bras"],
  ["T-bar row", "تجديف T-bar", "Remo en T", "T 杆划船", "T-bar-rodd", "T-Bar-Rudern", "Тяга Т-грифа", "Rowing en T"],
  ["Straight-arm pulldown", "سحب مستقيم الذراعين", "Jalón con brazos rectos", "直臂下压", "Raka armdrag", "Latziehen mit gestreckten Armen", "Тяга прямыми руками", "Tirage bras tendus"],
  ["Back extension", "تمديد الظهر", "Extensión lumbar", "背伸展", "Ryggresning", "Rückenstrecken", "Гиперэкстензия", "Extension lombaire"],
  ["Preacher curl", "بايسبس على المقعد", "Curl predicador", "牧师凳弯举", "Preachercurl", "Scottcurl", "Сгибание на скамье Скотта", "Curl pupitre"],
  ["Incline dumbbell curl", "بايسبس دمبل مائل", "Curl inclinado con mancuernas", "上斜哑铃弯举", "Lutande hantelcurl", "Schrägbank-Kurzhantelcurl", "Сгибание гантелей на наклонной", "Curl incliné aux haltères"],
  ["Reverse curl", "بايسبس بقبضة عكسية", "Curl inverso", "反握弯举", "Omvänd curl", "Reverse Curl", "Обратные сгибания", "Curl inversé"],
  ["Hack squat", "هاك سكوات", "Sentadilla hack", "哈克深蹲", "Hack squat", "Hackenschmidt-Kniebeuge", "Гакк-присед", "Hack squat"],
  ["Goblet squat", "سكوات الكأس", "Sentadilla goblet", "高脚杯深蹲", "Goblet squat", "Goblet Squat", "Кубковый присед", "Goblet squat"],
  ["Bulgarian split squat", "سكوات بلغاري", "Sentadilla búlgara", "保加利亚分腿蹲", "Bulgariska utfall", "Bulgarische Kniebeuge", "Болгарский сплит-присед", "Squat bulgare"],
  ["Sumo deadlift", "رفعة ميتة سومو", "Peso muerto sumo", "相扑硬拉", "Sumomarklyft", "Sumo-Kreuzheben", "Становая тяга сумо", "Soulevé de terre sumo"],
  ["Good morning", "تمرين صباح الخير", "Buenos días con barra", "早安式", "Good mornings", "Good Mornings", "Наклоны «доброе утро»", "Good morning"],
  ["Glute bridge", "جسر الأرداف", "Puente de glúteos", "臀桥", "Höftlyft", "Glute Bridge", "Ягодичный мост", "Pont fessier"],
  ["Cable glute kickback", "رفس خلفي بالكابل", "Patada de glúteo en polea", "绳索后踢腿", "Höftkick i kabel", "Glute Kickback am Kabel", "Отведение ноги назад в кроссовере", "Extension de hanche à la poulie"],
  ["Hip abduction", "إبعاد الورك", "Abducción de cadera", "髋外展", "Höftabduktion", "Hüftabduktion", "Отведение бедра", "Abduction de hanche"],
  ["Seated calf raise", "رفع السمانة جلوساً", "Elevación de gemelos sentado", "坐姿提踵", "Sittande vadpress", "Wadenheben sitzend", "Подъём на носки сидя", "Mollets assis"],
  ["Ab-wheel rollout", "تمرين عجلة البطن", "Rueda abdominal", "健腹轮", "Maghjul", "Ab-Roller", "Выкат с роликом", "Roue abdominale"],
  ["Russian twist", "لف روسي", "Giro ruso", "俄罗斯转体", "Rysk twist", "Russian Twist", "Русские скручивания", "Twist russe"],
  ["Pallof press", "ضغط بالوف", "Press Pallof", "帕洛夫推", "Pallofpress", "Pallof Press", "Жим Палоффа", "Press Pallof"],
  ["Mountain climber", "متسلق الجبل", "Escalador", "登山跑", "Mountain climber", "Bergsteiger", "Скалолаз", "Mountain climber"],
  ["Burpee", "بيربي", "Burpee", "波比跳", "Burpee", "Burpee", "Бёрпи", "Burpee"],
  ["Sled push", "دفع الزلاجة", "Empuje de trineo", "推雪橇", "Slädpress", "Schlitten schieben", "Толкание саней", "Poussée de traîneau"],
  ["Battle ropes", "حبال القتال", "Cuerdas de batalla", "战绳", "Battleropes", "Battle Ropes", "Боевые канаты", "Cordes ondulatoires"],
  ["Custom exercise", "تمرين مخصص", "Ejercicio personalizado", "自定义动作", "Egen övning", "Eigene Übung", "Своё упражнение", "Exercice personnalisé"],
] satisfies readonly Row[];

/**
 * Canonical translations for the expanded Workout catalog. Exercise names use
 * the customary training/sport term in each language rather than a literal
 * word-by-word translation. Keeping this list explicit also prevents machine
 * translation from turning short health labels into unrelated abbreviations.
 */
const expandedExerciseRows = [
  ["Crunch", "تمرين كرنش للبطن", "Crunch abdominal", "卷腹", "Crunch", "Crunch", "Скручивания", "Crunch abdominal"],
  ["Machine chest press", "ضغط الصدر على الجهاز", "Press de pecho en máquina", "器械推胸", "Bröstpress i maskin", "Brustpresse", "Жим от груди в тренажёре", "Développé poitrine à la machine"],
  ["Dumbbell chest fly", "تفتيح الصدر بالدمبل", "Aperturas con mancuernas", "哑铃飞鸟", "Bröstflyes med hantlar", "Kurzhantel-Flys", "Разведение гантелей лёжа", "Écarté couché avec haltères"],
  ["Pec deck", "جهاز تفتيح الصدر", "Contractora de pecho", "蝴蝶机夹胸", "Pec deck", "Butterfly-Maschine", "Сведение рук в тренажёре", "Pec deck"],
  ["Landmine press", "ضغط لاندماين", "Press landmine", "地雷管推举", "Landminepress", "Landmine Press", "Жим лэндмайн", "Développé landmine"],
  ["Front raise", "رفع أمامي", "Elevación frontal", "前平举", "Frontlyft", "Frontheben", "Подъём рук перед собой", "Élévation frontale"],
  ["Reverse pec deck", "تفتيح خلفي على الجهاز", "Pájaros en máquina", "反向蝴蝶机", "Omvänd pec deck", "Reverse Butterfly", "Обратная бабочка", "Oiseau à la machine"],
  ["Barbell shrug", "هز الكتفين بالبار", "Encogimiento con barra", "杠铃耸肩", "Axelryck med skivstång", "Langhantel-Shrugs", "Шраги со штангой", "Haussement d’épaules à la barre"],
  ["Dumbbell shrug", "هز الكتفين بالدمبل", "Encogimiento con mancuernas", "哑铃耸肩", "Axelryck med hantlar", "Kurzhantel-Shrugs", "Шраги с гантелями", "Haussement d’épaules avec haltères"],
  ["Dumbbell triceps extension", "تمديد الترايسبس بالدمبل", "Extensión de tríceps con mancuerna", "哑铃臂屈伸", "Tricepsextension med hantel", "Trizepsstrecken mit Kurzhantel", "Разгибание рук с гантелью", "Extension triceps avec haltère"],
  ["Cable overhead triceps extension", "تمديد الترايسبس فوق الرأس بالكابل", "Extensión de tríceps sobre la cabeza en polea", "绳索过顶臂屈伸", "Tricepsextension över huvudet i kabel", "Trizepsstrecken über Kopf am Kabel", "Разгибание рук над головой на блоке", "Extension triceps au-dessus de la tête à la poulie"],
  ["Rope triceps pushdown", "دفع الترايسبس بالحبل", "Extensión de tríceps con cuerda", "绳索下压", "Tricepspress med rep", "Trizepsdrücken mit Seil", "Разгибание рук с канатом", "Extension triceps à la corde"],
  ["Dumbbell triceps kickback", "ركلة ترايسبس بالدمبل", "Patada de tríceps con mancuerna", "哑铃俯身臂屈伸", "Triceps-kickback med hantel", "Kurzhantel-Trizeps-Kickback", "Разгибание руки с гантелью в наклоне", "Kickback triceps avec haltère"],
  ["Triceps dip", "متوازي للترايسبس", "Fondos de tríceps", "双杠臂屈伸（肱三头肌）", "Tricepsdips", "Trizeps-Dips", "Отжимания на брусьях на трицепс", "Dips triceps"],
  ["EZ-bar curl", "بايسبس ببار EZ", "Curl con barra EZ", "EZ 杠弯举", "Bicepscurl med EZ-stång", "SZ-Curl", "Сгибание рук с EZ-грифом", "Curl à la barre EZ"],
  ["Cable curl", "بايسبس بالكابل", "Curl en polea", "绳索弯举", "Bicepscurl i kabel", "Kabelcurl", "Сгибание рук на блоке", "Curl à la poulie"],
  ["Concentration curl", "بايسبس تركيز", "Curl de concentración", "集中弯举", "Koncentrationscurl", "Konzentrationscurl", "Концентрированный подъём", "Curl concentré"],
  ["Spider curl", "بايسبس سبايدر", "Curl araña", "蜘蛛弯举", "Spidercurl", "Spider Curl", "Паучьи сгибания", "Curl spider"],
  ["Chest-supported row", "تجديف مع دعم الصدر", "Remo con pecho apoyado", "俯卧支撑划船", "Bröststödd rodd", "Brustgestütztes Rudern", "Тяга с упором грудью", "Rowing poitrine appuyée"],
  ["Pendlay row", "تجديف بندلاي", "Remo Pendlay", "彭德雷划船", "Pendlayrodd", "Pendlay-Rudern", "Тяга Пендли", "Rowing Pendlay"],
  ["Machine row", "تجديف على الجهاز", "Remo en máquina", "器械划船", "Rodd i maskin", "Rudern an der Maschine", "Тяга в тренажёре", "Rowing à la machine"],
  ["Chin-up", "عقلة بقبضة سفلية", "Dominada supina", "反手引体向上", "Chins", "Klimmzug im Untergriff", "Подтягивание обратным хватом", "Traction en supination"],
  ["Hip adduction", "ضم الورك", "Aducción de cadera", "髋内收", "Höftadduktion", "Hüftadduktion", "Приведение бедра", "Adduction de hanche"],
  ["Lying leg curl", "ثني الأرجل مستلقياً", "Curl femoral tumbado", "俯卧腿弯举", "Liggande lårcurl", "Beinbeugen liegend", "Сгибание ног лёжа", "Leg curl allongé"],
  ["Seated leg curl", "ثني الأرجل جلوساً", "Curl femoral sentado", "坐姿腿弯举", "Sittande lårcurl", "Beinbeugen sitzend", "Сгибание ног сидя", "Leg curl assis"],
  ["Single-leg press", "ضغط رجل واحدة", "Prensa a una pierna", "单腿腿举", "Enbenspress", "Einbeinige Beinpresse", "Жим одной ногой", "Presse à une jambe"],
  ["Step-up", "صعود الصندوق", "Subida al cajón", "登台阶", "Uppsteg", "Aufsteigen", "Зашагивание на платформу", "Montée sur banc"],
  ["Reverse lunge", "اندفاع خلفي", "Zancada hacia atrás", "反向弓步", "Bakåtutfall", "Rückwärts-Ausfallschritt", "Выпад назад", "Fente arrière"],
  ["Standing calf raise", "رفع السمانة واقفاً", "Elevación de gemelos de pie", "站姿提踵", "Stående vadpress", "Wadenheben stehend", "Подъём на носки стоя", "Mollets debout"],
  ["Donkey calf raise", "رفع السمانة بوضع الحمار", "Elevación de gemelos tipo burro", "驴式提踵", "Donkey-vadpress", "Donkey-Wadenheben", "Подъём на носки в наклоне", "Mollets donkey"],
  ["Sit-up", "تمرين الجلوس للبطن", "Abdominal completo", "仰卧起坐", "Sit-up", "Sit-up", "Подъём корпуса", "Redressement assis"],
  ["Bicycle crunch", "كرنش الدراجة", "Abdominal bicicleta", "自行车卷腹", "Cykelcrunch", "Fahrrad-Crunch", "Велосипедные скручивания", "Crunch bicyclette"],
  ["Reverse crunch", "كرنش عكسي", "Crunch inverso", "反向卷腹", "Omvänd crunch", "Reverse Crunch", "Обратные скручивания", "Crunch inversé"],
  ["Dead bug", "تمرين ديد باغ", "Dead bug", "死虫式", "Dead bug", "Dead Bug", "Мёртвый жук", "Dead bug"],
  ["Side plank", "بلانك جانبي", "Plancha lateral", "侧平板支撑", "Sidoplanka", "Seitstütz", "Боковая планка", "Gainage latéral"],
  ["Power clean", "كلين القوة", "Cargada de potencia", "高翻", "Styrkevändning", "Power Clean", "Взятие на грудь в стойку", "Épaulé en puissance"],
  ["Clean and jerk", "كلين ونتر", "Dos tiempos", "挺举", "Stöt", "Umsetzen und Stoßen", "Толчок", "Épaulé-jeté"],
  ["Snatch", "خطف", "Arrancada", "抓举", "Ryck", "Reißen", "Рывок", "Arraché"],
  ["Walking", "المشي", "Caminar", "步行", "Promenad", "Gehen", "Ходьба", "Marche"],
  ["Running", "الجري", "Correr", "跑步", "Löpning", "Laufen", "Бег", "Course à pied"],
  ["Track running", "الجري على المضمار", "Carrera en pista", "田径场跑步", "Banalöpning", "Bahn­laufen", "Бег по стадиону", "Course sur piste"],
  ["Treadmill running", "الجري على جهاز المشي", "Carrera en cinta", "跑步机跑步", "Löpband", "Laufband", "Бег на дорожке", "Course sur tapis"],
  ["Cycling", "ركوب الدراجة", "Ciclismo", "骑行", "Cykling", "Radfahren", "Велоспорт", "Cyclisme"],
  ["Stationary cycling", "الدراجة الثابتة", "Bicicleta estática", "室内单车", "Motionscykel", "Ergometer", "Велотренажёр", "Vélo d’appartement"],
  ["Mountain biking", "ركوب الدراجة الجبلية", "Ciclismo de montaña", "山地骑行", "Mountainbike", "Mountainbiken", "Маунтинбайк", "VTT"],
  ["Hand cycling", "الدراجة اليدوية", "Ciclismo de manos", "手摇自行车", "Handcykling", "Handbike", "Хендбайк", "Handbike"],
  ["Elliptical", "جهاز الإليبتيكال", "Elíptica", "椭圆机", "Crosstrainer", "Crosstrainer", "Эллиптический тренажёр", "Vélo elliptique"],
  ["Stair climbing", "صعود الدرج", "Subir escaleras", "爬楼梯", "Trappgång", "Treppensteigen", "Подъём по лестнице", "Montée d’escaliers"],
  ["Stair climbing machine", "جهاز صعود الدرج", "Máquina de escaleras", "爬楼机", "Trappmaskin", "Treppensteiger", "Степпер-лестница", "Escalier mécanique"],
  ["Rowing machine", "جهاز التجديف", "Máquina de remo", "划船机", "Roddmaskin", "Rudergerät", "Гребной тренажёр", "Rameur"],
  ["Wheelchair walk pace", "دفع الكرسي المتحرك بوتيرة المشي", "Silla de ruedas a ritmo de paseo", "轮椅慢速推进", "Rullstol i gångtempo", "Rollstuhlfahren im Gehtempo", "Езда на коляске в темпе ходьбы", "Fauteuil roulant à allure de marche"],
  ["Wheelchair run pace", "دفع الكرسي المتحرك بوتيرة الجري", "Silla de ruedas a ritmo de carrera", "轮椅快速推进", "Rullstol i löptempo", "Rollstuhlfahren im Lauftempo", "Езда на коляске в темпе бега", "Fauteuil roulant à allure de course"],
  ["Strength training", "تمارين القوة", "Entrenamiento de fuerza", "力量训练", "Styrketräning", "Krafttraining", "Силовая тренировка", "Musculation"],
  ["Functional strength training", "تمارين القوة الوظيفية", "Entrenamiento de fuerza funcional", "功能性力量训练", "Funktionell styrketräning", "Funktionelles Krafttraining", "Функциональная силовая тренировка", "Renforcement fonctionnel"],
  ["Weightlifting", "رفع الأثقال", "Halterofilia", "举重", "Tyngdlyftning", "Gewichtheben", "Тяжёлая атлетика", "Haltérophilie"],
  ["Weight machine", "أجهزة الأوزان", "Máquinas de pesas", "力量器械训练", "Styrkemaskin", "Kraftgerät", "Силовой тренажёр", "Machine de musculation"],
  ["Aerobics", "تمارين الأيروبيك", "Aeróbic", "有氧操", "Aerobics", "Aerobic", "Аэробика", "Aérobic"],
  ["Boot camp", "تمارين بوت كامب", "Entrenamiento militar", "新兵训练营", "Bootcamp", "Bootcamp", "Буткемп", "Bootcamp"],
  ["Calisthenics", "تمارين وزن الجسم", "Calistenia", "徒手训练", "Kroppsviktsträning", "Calisthenics", "Калистеника", "Callisthénie"],
  ["Circuit training", "تمارين دائرية", "Entrenamiento en circuito", "循环训练", "Cirkelträning", "Zirkeltraining", "Круговая тренировка", "Entraînement en circuit"],
  ["Cross training", "تمارين كروس ترينينغ", "Entrenamiento cruzado", "交叉训练", "Crossträning", "Cross-Training", "Кросс-тренинг", "Cross-training"],
  ["Mixed cardio", "تمارين كارديو متنوعة", "Cardio mixto", "混合有氧运动", "Blandad konditionsträning", "Gemischtes Cardiotraining", "Смешанная кардиотренировка", "Cardio mixte"],
  ["High-intensity interval training", "تمارين متقطعة عالية الشدة", "Entrenamiento interválico de alta intensidad", "高强度间歇训练", "Högintensiv intervallträning", "Hochintensives Intervalltraining", "Высокоинтенсивная интервальная тренировка", "Entraînement fractionné de haute intensité"],
  ["Exercise class", "حصة تمارين", "Clase de ejercicio", "团体健身课", "Träningsklass", "Fitnesskurs", "Групповое занятие", "Cours collectif"],
  ["Fitness gaming", "ألعاب اللياقة", "Videojuegos de ejercicio", "健身游戏", "Träningsspel", "Fitness-Gaming", "Фитнес-игры", "Jeu vidéo sportif"],
  ["Gymnastics", "الجمباز", "Gimnasia", "体操", "Gymnastik", "Turnen", "Гимнастика", "Gymnastique"],
  ["Jump rope", "نط الحبل", "Saltar a la comba", "跳绳", "Hopprep", "Seilspringen", "Прыжки со скакалкой", "Corde à sauter"],
  ["Hula hooping", "الهولا هوب", "Hula hoop", "呼啦圈", "Rockring", "Hula-Hoop", "Обруч", "Hula-hoop"],
  ["Jumping jacks", "قفز فتح وضم", "Saltos de tijera", "开合跳", "Krysshopp", "Hampelmänner", "Прыжки ноги врозь", "Jumping jacks"],
  ["Skaters", "قفز المتزلج", "Saltos de patinador", "滑冰跳", "Skridskohopp", "Skater-Sprünge", "Прыжки конькобежца", "Sauts du patineur"],
  ["High knees", "رفع الركبتين عالياً", "Rodillas altas", "高抬腿", "Höga knän", "Kniehebelauf", "Бег с высоким подниманием колен", "Montées de genoux"],
  ["Stretching", "تمارين الإطالة", "Estiramientos", "拉伸", "Stretching", "Dehnen", "Растяжка", "Étirements"],
  ["Warm-up", "الإحماء", "Calentamiento", "热身", "Uppvärmning", "Aufwärmen", "Разминка", "Échauffement"],
  ["Cool-down", "التهدئة بعد التمرين", "Vuelta a la calma", "整理运动", "Nedvarvning", "Abwärmen", "Заминка", "Retour au calme"],
  ["Preparation and recovery", "التحضير والتعافي", "Preparación y recuperación", "准备与恢复", "Förberedelse och återhämtning", "Vorbereitung und Erholung", "Подготовка и восстановление", "Préparation et récupération"],
  ["Yoga", "اليوغا", "Yoga", "瑜伽", "Yoga", "Yoga", "Йога", "Yoga"],
  ["Pilates", "البيلاتس", "Pilates", "普拉提", "Pilates", "Pilates", "Пилатес", "Pilates"],
  ["Tai chi", "تاي تشي", "Taichí", "太极拳", "Tai chi", "Tai-Chi", "Тайцзи", "Tai-chi"],
  ["Barre", "تمارين البار", "Barre", "芭杆训练", "Barreträning", "Barre-Training", "Барре", "Barre"],
  ["Core training", "تمارين الجذع", "Entrenamiento del core", "核心训练", "Bålträning", "Rumpftraining", "Тренировка кора", "Renforcement du tronc"],
  ["Guided breathing", "تنفس موجه", "Respiración guiada", "引导式呼吸", "Guidad andning", "Geführte Atemübung", "Дыхательная практика", "Respiration guidée"],
  ["Dance", "الرقص", "Baile", "舞蹈", "Dans", "Tanzen", "Танцы", "Danse"],
  ["Ballet", "الباليه", "Ballet", "芭蕾", "Balett", "Ballett", "Балет", "Ballet"],
  ["Ballroom dance", "رقص الصالات", "Baile de salón", "交谊舞", "Sällskapsdans", "Gesellschaftstanz", "Бальные танцы", "Danse de salon"],
  ["Cardio dance", "رقص كارديو", "Baile cardio", "有氧舞蹈", "Konditionsdans", "Cardio-Dance", "Танцевальное кардио", "Danse cardio"],
  ["Social dance", "رقص اجتماعي", "Baile social", "社交舞", "Socialdans", "Gesellschaftstanz", "Социальные танцы", "Danse sociale"],
  ["Zumba", "زومبا", "Zumba", "尊巴", "Zumba", "Zumba", "Зумба", "Zumba"],
  ["Baseball", "البيسبول", "Béisbol", "棒球", "Baseboll", "Baseball", "Бейсбол", "Baseball"],
  ["Softball", "السوفتبول", "Sóftbol", "垒球", "Softboll", "Softball", "Софтбол", "Softball"],
  ["Cricket", "الكريكيت", "Críquet", "板球", "Cricket", "Cricket", "Крикет", "Cricket"],
  ["Basketball", "كرة السلة", "Baloncesto", "篮球", "Basket", "Basketball", "Баскетбол", "Basket-ball"],
  ["Soccer", "كرة القدم", "Fútbol", "足球", "Fotboll", "Fußball", "Футбол", "Football"],
  ["American football", "كرة القدم الأمريكية", "Fútbol americano", "美式橄榄球", "Amerikansk fotboll", "American Football", "Американский футбол", "Football américain"],
  ["Australian football", "كرة القدم الأسترالية", "Fútbol australiano", "澳式橄榄球", "Australisk fotboll", "Australian Football", "Австралийский футбол", "Football australien"],
  ["Rugby", "الرجبي", "Rugby", "橄榄球", "Rugby", "Rugby", "Регби", "Rugby"],
  ["Handball", "كرة اليد", "Balonmano", "手球", "Handboll", "Handball", "Гандбол", "Handball"],
  ["Volleyball", "الكرة الطائرة", "Voleibol", "排球", "Volleyboll", "Volleyball", "Волейбол", "Volley-ball"],
  ["Beach volleyball", "الكرة الطائرة الشاطئية", "Vóley playa", "沙滩排球", "Beachvolleyboll", "Beachvolleyball", "Пляжный волейбол", "Beach-volley"],
  ["Hockey", "الهوكي", "Hockey", "曲棍球", "Landhockey", "Hockey", "Хоккей на траве", "Hockey sur gazon"],
  ["Ice hockey", "هوكي الجليد", "Hockey sobre hielo", "冰球", "Ishockey", "Eishockey", "Хоккей с шайбой", "Hockey sur glace"],
  ["Roller hockey", "هوكي التزلج", "Hockey sobre patines", "轮滑曲棍球", "Rullhockey", "Rollhockey", "Хоккей на роликах", "Rink hockey"],
  ["Lacrosse", "لاكروس", "Lacrosse", "长曲棍球", "Lacrosse", "Lacrosse", "Лакросс", "Crosse"],
  ["Disc sports", "رياضات القرص", "Deportes de disco", "飞盘运动", "Discsport", "Discsport", "Спорт с летающим диском", "Sports de disque"],
  ["Badminton", "الريشة الطائرة", "Bádminton", "羽毛球", "Badminton", "Badminton", "Бадминтон", "Badminton"],
  ["Tennis", "التنس", "Tenis", "网球", "Tennis", "Tennis", "Теннис", "Tennis"],
  ["Table tennis", "تنس الطاولة", "Tenis de mesa", "乒乓球", "Bordtennis", "Tischtennis", "Настольный теннис", "Tennis de table"],
  ["Squash", "الاسكواش", "Squash", "壁球", "Squash", "Squash", "Сквош", "Squash"],
  ["Racquetball", "راكيت بول", "Ráquetbol", "美式壁球", "Racquetball", "Racquetball", "Ракетбол", "Racquetball"],
  ["Pickleball", "بيكل بول", "Pickleball", "匹克球", "Pickleball", "Pickleball", "Пиклбол", "Pickleball"],
  ["Boxing", "الملاكمة", "Boxeo", "拳击", "Boxning", "Boxen", "Бокс", "Boxe"],
  ["Kickboxing", "الكيك بوكسينغ", "Kickboxing", "踢拳", "Kickboxning", "Kickboxen", "Кикбоксинг", "Kick-boxing"],
  ["Martial arts", "الفنون القتالية", "Artes marciales", "武术", "Kampsport", "Kampfsport", "Боевые искусства", "Arts martiaux"],
  ["Wrestling", "المصارعة", "Lucha", "摔跤", "Brottning", "Ringen", "Борьба", "Lutte"],
  ["Fencing", "المبارزة", "Esgrima", "击剑", "Fäktning", "Fechten", "Фехтование", "Escrime"],
  ["Hiking", "المشي لمسافات طويلة", "Senderismo", "徒步", "Vandring", "Wandern", "Пеший туризм", "Randonnée"],
  ["Backpacking", "الترحال بحقيبة الظهر", "Trekking con mochila", "背包徒步", "Ryggsäcksvandring", "Trekking", "Поход с рюкзаком", "Trekking"],
  ["Orienteering", "رياضة التوجيه", "Orientación", "定向越野", "Orientering", "Orientierungslauf", "Спортивное ориентирование", "Course d’orientation"],
  ["Rock climbing", "تسلق الصخور", "Escalada", "攀岩", "Klättring", "Klettern", "Скалолазание", "Escalade"],
  ["Paragliding", "الطيران الشراعي", "Parapente", "滑翔伞", "Skärmflygning", "Gleitschirmfliegen", "Парапланеризм", "Parapente"],
  ["Hang gliding", "الطيران الشراعي المعلق", "Ala delta", "悬挂滑翔", "Hängflygning", "Drachenfliegen", "Дельтапланеризм", "Deltaplane"],
  ["Horseback riding", "ركوب الخيل", "Equitación", "骑马", "Ridning", "Reiten", "Верховая езда", "Équitation"],
  ["Fishing", "صيد السمك", "Pesca", "钓鱼", "Fiske", "Angeln", "Рыбалка", "Pêche"],
  ["Hunting", "الصيد", "Caza", "狩猎", "Jakt", "Jagd", "Охота", "Chasse"],
  ["Golf", "الغولف", "Golf", "高尔夫", "Golf", "Golf", "Гольф", "Golf"],
  ["Archery", "الرماية بالقوس", "Tiro con arco", "射箭", "Bågskytte", "Bogenschießen", "Стрельба из лука", "Tir à l’arc"],
  ["Bowling", "البولينغ", "Bolos", "保龄球", "Bowling", "Bowling", "Боулинг", "Bowling"],
  ["Inline skating", "التزلج بالعجلات في خط واحد", "Patinaje en línea", "直排轮滑", "Inlinesåkning", "Inlineskaten", "Роликовые коньки", "Roller en ligne"],
  ["Roller skating", "التزلج بالعجلات", "Patinaje sobre ruedas", "双排轮滑", "Rullskridskoåkning", "Rollschuhlaufen", "Катание на роликах", "Patin à roulettes"],
  ["Play", "اللعب النشط", "Juego activo", "玩耍", "Aktiv lek", "Aktives Spielen", "Активная игра", "Jeu actif"],
  ["Swimming", "السباحة", "Natación", "游泳", "Simning", "Schwimmen", "Плавание", "Natation"],
  ["Pool swimming", "السباحة في المسبح", "Natación en piscina", "泳池游泳", "Bassängsimning", "Schwimmen im Becken", "Плавание в бассейне", "Natation en piscine"],
  ["Open-water swimming", "السباحة في المياه المفتوحة", "Natación en aguas abiertas", "公开水域游泳", "Öppet vatten-simning", "Freiwasserschwimmen", "Плавание на открытой воде", "Natation en eau libre"],
  ["Water fitness", "تمارين اللياقة المائية", "Fitness acuático", "水中健身", "Vattenträning", "Aquafitness", "Аквафитнес", "Aquagym"],
  ["Water polo", "كرة الماء", "Waterpolo", "水球", "Vattenpolo", "Wasserball", "Водное поло", "Water-polo"],
  ["Paddling", "التجديف بالمجداف", "Remo con pala", "桨板运动", "Paddling", "Paddeln", "Гребля с веслом", "Sports de pagaie"],
  ["Canoeing", "التجديف بالكانوي", "Piragüismo", "划独木舟", "Kanotpaddling", "Kanufahren", "Каноэ", "Canoë"],
  ["Kayaking", "التجديف بالكاياك", "Kayak", "皮划艇", "Kajakpaddling", "Kajakfahren", "Каякинг", "Kayak"],
  ["Rafting", "التجديف النهري", "Rafting", "漂流", "Forsränning", "Rafting", "Рафтинг", "Rafting"],
  ["Rowing", "التجديف", "Remo", "赛艇", "Rodd", "Rudern", "Гребля", "Aviron"],
  ["Sailing", "الإبحار الشراعي", "Vela", "帆船", "Segling", "Segeln", "Парусный спорт", "Voile"],
  ["Yachting", "الإبحار باليخت", "Navegación en yate", "游艇", "Segling med yacht", "Yachtsport", "Яхтинг", "Yachting"],
  ["Surfing", "ركوب الأمواج", "Surf", "冲浪", "Surfing", "Surfen", "Сёрфинг", "Surf"],
  ["Windsurfing", "ركوب الأمواج شراعياً", "Windsurf", "帆板", "Vindsurfing", "Windsurfen", "Виндсёрфинг", "Planche à voile"],
  ["Kitesurfing", "ركوب الأمواج بالطائرة الورقية", "Kitesurf", "风筝冲浪", "Kitesurfing", "Kitesurfen", "Кайтсёрфинг", "Kitesurf"],
  ["Water skiing", "التزلج على الماء", "Esquí acuático", "滑水", "Vattenskidor", "Wasserski", "Водные лыжи", "Ski nautique"],
  ["Scuba diving", "الغوص بجهاز التنفس", "Buceo", "水肺潜水", "Dykning", "Gerätetauchen", "Дайвинг", "Plongée sous-marine"],
  ["Snorkeling", "الغطس بالسنوركل", "Esnórquel", "浮潜", "Snorkling", "Schnorcheln", "Сноркелинг", "Plongée avec tuba"],
  ["Skiing", "التزلج على الثلج", "Esquí", "滑雪", "Skidåkning", "Skifahren", "Лыжный спорт", "Ski"],
  ["Cross-country skiing", "التزلج الريفي", "Esquí de fondo", "越野滑雪", "Längdskidåkning", "Langlauf", "Лыжные гонки", "Ski de fond"],
  ["Downhill skiing", "التزلج على المنحدرات", "Esquí alpino", "高山滑雪", "Utförsåkning", "Ski alpin", "Горные лыжи", "Ski alpin"],
  ["Snowboarding", "التزلج على اللوح", "Snowboard", "单板滑雪", "Snowboard", "Snowboarden", "Сноуборд", "Snowboard"],
  ["Snowshoeing", "المشي بأحذية الثلج", "Raquetas de nieve", "雪鞋行走", "Snöskovandring", "Schneeschuhwandern", "Ходьба на снегоступах", "Raquettes à neige"],
  ["Ice skating", "التزلج على الجليد", "Patinaje sobre hielo", "滑冰", "Skridskoåkning", "Eislaufen", "Катание на коньках", "Patinage sur glace"],
  ["Ice dancing", "الرقص على الجليد", "Danza sobre hielo", "冰上舞蹈", "Isdans", "Eistanz", "Танцы на льду", "Danse sur glace"],
  ["Curling", "الكيرلنغ", "Curling", "冰壶", "Curling", "Curling", "Кёрлинг", "Curling"],
  ["Triathlon", "الترياثلون", "Triatlón", "铁人三项", "Triathlon", "Triathlon", "Триатлон", "Triathlon"],
  ["Duathlon", "الدواثلون", "Duatlón", "铁人两项", "Duathlon", "Duathlon", "Дуатлон", "Duathlon"],
  ["Aquathlon", "الأكواثلون", "Acuatlón", "水陆两项", "Aquathlon", "Aquathlon", "Акватлон", "Aquathlon"],
  ["Aquabike", "الأكوابايك", "Aquabike", "游泳自行车两项", "Aquabike", "Aquabike", "Аквабайк", "Aquabike"],
  ["Cross triathlon", "ترياثلون الطرق الوعرة", "Triatlón cross", "越野铁人三项", "Crosstriathlon", "Cross-Triathlon", "Кросс-триатлон", "Cross-triathlon"],
  ["Cross duathlon", "دواثلون الطرق الوعرة", "Duatlón cross", "越野铁人两项", "Crossduathlon", "Cross-Duathlon", "Кросс-дуатлон", "Cross-duathlon"],
  ["Multisport transition", "مرحلة الانتقال في الرياضات المتعددة", "Transición multideporte", "多项运动转换", "Växling i multisport", "Multisport-Wechsel", "Транзитная зона мультиспорта", "Transition multisport"],
  ["Workout break", "استراحة التمرين", "Pausa del entrenamiento", "锻炼休息", "Träningspaus", "Trainingspause", "Перерыв в тренировке", "Pause d’entraînement"],
  ["Other workout", "تمرين آخر", "Otro entrenamiento", "其他锻炼", "Annan träning", "Anderes Training", "Другая тренировка", "Autre entraînement"],
] satisfies readonly Row[];

const fixedRows = [
  ["HabHub update", "تحديث HabHub", "Actualización de HabHub", "HabHub 更新", "HabHub-uppdatering", "HabHub-Update", "Обновление HabHub", "Mise à jour HabHub"],
  ["New message", "رسالة جديدة", "Mensaje nuevo", "新消息", "Nytt meddelande", "Neue Nachricht", "Новое сообщение", "Nouveau message"],
  ["Sent an image", "أرسل صورة", "Envió una imagen", "发送了一张图片", "Skickade en bild", "Hat ein Bild gesendet", "Отправлено изображение", "A envoyé une image"],
  ["a metric", "مؤشرًا", "un indicador", "一项指标", "ett mätvärde", "einen Tracker", "показатель", "un suivi"],
  ["metric", "مؤشر", "indicador", "指标", "mätvärde", "Tracker", "показатель", "suivi"],
  ["A shared metric update was added.", "تمت إضافة تحديث مشترك للمؤشر.", "Se añadió una actualización compartida.", "已添加一条共享指标更新。", "En delad uppdatering lades till.", "Ein geteiltes Tracker-Update wurde hinzugefügt.", "Добавлено общее обновление показателя.", "Une mise à jour partagée a été ajoutée."],
  ["Group membership updated", "تم تحديث عضوية المجموعة", "Membresía del grupo actualizada", "群组成员资格已更新", "Gruppmedlemskapet uppdaterades", "Gruppenmitgliedschaft aktualisiert", "Участие в группе обновлено", "Adhésion au groupe mise à jour"],
  ["Your request was approved. Tap to open the group.", "تمت الموافقة على طلبك. اضغط لفتح المجموعة.", "Tu solicitud fue aprobada. Toca para abrir el grupo.", "你的请求已获批准。点按以打开群组。", "Din begäran godkändes. Tryck för att öppna gruppen.", "Deine Anfrage wurde genehmigt. Tippe, um die Gruppe zu öffnen.", "Ваш запрос одобрен. Нажмите, чтобы открыть группу.", "Votre demande a été approuvée. Touchez pour ouvrir le groupe."],
  ["Last week's group winners", "فائزو المجموعة في الأسبوع الماضي", "Ganadores del grupo de la semana pasada", "上周群组优胜者", "Förra veckans gruppvinnare", "Gruppens Gewinner der letzten Woche", "Победители группы за прошлую неделю", "Gagnants du groupe de la semaine dernière"],
  ["Last month's group winners", "فائزو المجموعة في الشهر الماضي", "Ganadores del grupo del mes pasado", "上月群组优胜者", "Förra månadens gruppvinnare", "Gruppens Gewinner des letzten Monats", "Победители группы за прошлый месяц", "Gagnants du groupe du mois dernier"],
  ["Period estimate", "تقدير موعد الدورة", "Estimación del periodo", "经期预测", "Mensprognos", "Periodenschätzung", "Прогноз менструации", "Estimation des règles"],
  ["Menstrual phase estimate", "تقدير مرحلة الحيض", "Estimación de la fase menstrual", "月经期预测", "Prognos för menstruationsfas", "Schätzung der Menstruationsphase", "Прогноз менструальной фазы", "Estimation de la phase menstruelle"],
  ["Follicular phase estimate", "تقدير المرحلة الجريبية", "Estimación de la fase folicular", "卵泡期预测", "Prognos för follikelfas", "Schätzung der Follikelphase", "Прогноз фолликулярной фазы", "Estimation de la phase folliculaire"],
  ["Ovulation phase estimate", "تقدير مرحلة الإباضة", "Estimación de la ovulación", "排卵期预测", "Prognos för ägglossning", "Schätzung der Ovulationsphase", "Прогноз овуляции", "Estimation de la phase d’ovulation"],
  ["Luteal phase estimate", "تقدير المرحلة الأصفرية", "Estimación de la fase lútea", "黄体期预测", "Prognos för lutealfas", "Schätzung der Lutealphase", "Прогноз лютеиновой фазы", "Estimation de la phase lutéale"],
  ["To-do deadline", "موعد استحقاق المهمة", "Fecha límite de la tarea", "待办截止日期", "Deadline för uppgift", "Aufgabenfrist", "Срок задачи", "Échéance de la tâche"],
  ["To-do reminder", "تذكير بالمهمة", "Recordatorio de tarea", "待办提醒", "Uppgiftspåminnelse", "Aufgabenerinnerung", "Напоминание о задаче", "Rappel de tâche"],
  ["A scheduled tracker reminder is ready.", "حان موعد تذكير المؤشر المجدول.", "Hay un recordatorio programado del indicador.", "计划的指标提醒已就绪。", "En schemalagd spårarpåminnelse är klar.", "Eine geplante Tracker-Erinnerung ist fällig.", "Запланированное напоминание о показателе готово.", "Un rappel de suivi programmé est prêt."],
  ["A scheduled to-do reminder is ready.", "حان موعد تذكير المهمة المجدول.", "Hay un recordatorio programado de tarea.", "计划的待办提醒已就绪。", "En schemalagd uppgiftspåminnelse är klar.", "Eine geplante Aufgaben-Erinnerung ist fällig.", "Запланированное напоминание о задаче готово.", "Un rappel de tâche programmé est prêt."],
  ["Scheduled reminder", "تذكير مجدول", "Recordatorio programado", "计划提醒", "Schemalagd påminnelse", "Geplante Erinnerung", "Запланированное напоминание", "Rappel programmé"],
  ["Your first baseline", "خط البداية الأول", "Tu primer punto de referencia", "你的首个基准", "Din första baslinje", "Dein erster Ausgangswert", "Ваша первая отправная точка", "Votre premier repère"],
  ["Complete a workout to start exercise and muscle-group trends.", "أكمل تمرينًا لبدء اتجاهات التمارين ومجموعات العضلات.", "Completa un entrenamiento para iniciar las tendencias por ejercicio y grupo muscular.", "完成一次训练即可开始查看动作和肌群趋势。", "Slutför ett pass för att starta trender för övningar och muskelgrupper.", "Schließe ein Training ab, um Übungs- und Muskelgruppentrends zu starten.", "Завершите тренировку, чтобы увидеть динамику упражнений и групп мышц.", "Terminez une séance pour lancer les tendances par exercice et groupe musculaire."],
  ["No clear estimated-strength best for at least four weeks. Recovery, technique, repetitions, or a small 2–10% load progression may be worth reviewing.", "لا يوجد أفضل أداء واضح للقوة التقديرية منذ أربعة أسابيع على الأقل. راجع التعافي أو الأسلوب أو التكرارات أو زيادة الحمل تدريجيًا بنسبة 2–10٪.", "No hay una mejor marca clara de fuerza estimada desde hace al menos cuatro semanas. Conviene revisar recuperación, técnica, repeticiones o una subida de carga del 2–10 %.", "至少四周没有明确的估算力量新高。可考虑检查恢复、动作技术、次数或将负重小幅提高 2–10%。", "Ingen tydlig styrketopp på minst fyra veckor. Se över återhämtning, teknik, repetitioner eller en liten belastningsökning på 2–10 %.", "Seit mindestens vier Wochen kein klarer Bestwert der geschätzten Kraft. Prüfe Erholung, Technik, Wiederholungen oder eine kleine Laststeigerung von 2–10 %.", "Не было явного лучшего результата расчётной силы минимум четыре недели. Стоит проверить восстановление, технику, повторы или прибавить 2–10 % нагрузки.", "Aucun record clair de force estimée depuis au moins quatre semaines. Revoyez récupération, technique, répétitions ou une petite hausse de charge de 2 à 10 %."],
  ["Live overall leader", "المتصدر العام الحالي", "Líder general actual", "当前总榜领先者", "Totalledare just nu", "Aktueller Gesamtführender", "Текущий общий лидер", "Leader général actuel"],
  ["Previous-day champion", "بطل اليوم السابق", "Campeón del día anterior", "前一日冠军", "Föregående dags mästare", "Champion des Vortags", "Чемпион предыдущего дня", "Champion de la veille"],
  ["Week champion", "بطل الأسبوع", "Campeón de la semana", "本周冠军", "Veckomästare", "Wochensieger", "Чемпион недели", "Champion de la semaine"],
  ["Month leader", "متصدر الشهر", "Líder del mes", "月度领先者", "Månadsledare", "Monatsführender", "Лидер месяца", "Leader du mois"],
  ["Year leader", "متصدر السنة", "Líder del año", "年度领先者", "Årsledare", "Jahresführender", "Лидер года", "Leader de l’année"],
  ["All daily goals", "كل الأهداف اليومية", "Todos los objetivos diarios", "全部每日目标", "Alla dagliga mål", "Alle Tagesziele", "Все дневные цели", "Tous les objectifs quotidiens"],
  ["Group check-ins", "تسجيلات المجموعة", "Registros del grupo", "群组打卡", "Gruppincheckningar", "Gruppen-Check-ins", "Отметки в группе", "Présences du groupe"],
  ["Comeback", "العودة القوية", "Remontada", "强势回归", "Comeback", "Comeback", "Возвращение", "Retour en force"],
  ["Goal machine", "آلة الأهداف", "Máquina de objetivos", "目标达人", "Målmaskin", "Zielmaschine", "Машина целей", "Machine à objectifs"],
  ["Low-carb week", "أسبوع منخفض الكربوهيدرات", "Semana baja en carbohidratos", "低碳一周", "Lågkolhydratvecka", "Low-Carb-Woche", "Неделя с низким содержанием углеводов", "Semaine pauvre en glucides"],
  ["Up for grabs", "متاح للفوز", "Por conquistar", "等待争夺", "Öppet att ta", "Noch zu holen", "Можно завоевать", "À décrocher"],
  ["Not yet earned", "لم تُكتسب بعد", "Aún no conseguido", "尚未获得", "Inte uppnått än", "Noch nicht erreicht", "Ещё не получено", "Pas encore obtenu"],
  ["Keep moving", "واصل التقدم", "Sigue avanzando", "继续前进", "Fortsätt framåt", "Bleib in Bewegung", "Продолжайте двигаться", "Continuez d’avancer"],
  ["Top completion milestone reached.", "تم بلوغ أعلى إنجاز للإكمال.", "Se alcanzó el mayor hito de finalización.", "已达到最高完成里程碑。", "Högsta slutförandemålet är nått.", "Höchster Abschlussmeilenstein erreicht.", "Достигнута высшая отметка выполнения.", "Palier maximal de réalisation atteint."],
  ["Top perfect-day milestone reached.", "تم بلوغ أعلى إنجاز لليوم المثالي.", "Se alcanzó el mayor hito de días perfectos.", "已达到最高完美日里程碑。", "Högsta milstolpen för perfekta dagar är nådd.", "Höchster Meilenstein für perfekte Tage erreicht.", "Достигнута высшая отметка идеальных дней.", "Palier maximal de journées parfaites atteint."],
  ["Top check-in milestone reached.", "تم بلوغ أعلى إنجاز لتسجيل الحضور.", "Se alcanzó el mayor hito de registros.", "已达到最高打卡里程碑。", "Högsta incheckningsmilstolpen är nådd.", "Höchster Check-in-Meilenstein erreicht.", "Достигнута высшая отметка активности.", "Palier maximal de présence atteint."],
  ["Selected day", "اليوم المحدد", "Día seleccionado", "所选日期", "Vald dag", "Ausgewählter Tag", "Выбранный день", "Jour sélectionné"],
  ["Previous day", "اليوم السابق", "Día anterior", "前一天", "Föregående dag", "Vorheriger Tag", "Предыдущий день", "Jour précédent"],
  ["Week awards", "جوائز الأسبوع", "Premios semanales", "每周奖励", "Veckopriser", "Wochenauszeichnungen", "Награды недели", "Récompenses de la semaine"],
  ["Month awards", "جوائز الشهر", "Premios mensuales", "每月奖励", "Månadspriser", "Monatsauszeichnungen", "Награды месяца", "Récompenses du mois"],
  ["Year awards", "جوائز السنة", "Premios anuales", "年度奖励", "Årspriser", "Jahresauszeichnungen", "Награды года", "Récompenses de l’année"],
  ["Achievements", "الإنجازات", "Logros", "成就", "Prestationer", "Erfolge", "Достижения", "Réalisations"],
  ["Current leader", "المتصدر الحالي", "Líder actual", "当前领先者", "Nuvarande ledare", "Aktuell führend", "Текущий лидер", "Leader actuel"],
  ["Final daily winner", "الفائز النهائي لليوم", "Ganador final del día", "当日最终获胜者", "Dagens slutliga vinnare", "Endgültiger Tagessieger", "Итоговый победитель дня", "Vainqueur final du jour"],
  ["This week", "هذا الأسبوع", "Esta semana", "本周", "Den här veckan", "Diese Woche", "На этой неделе", "Cette semaine"],
  ["Month", "الشهر", "Mes", "月", "Månad", "Monat", "Месяц", "Mois"],
  ["Year", "السنة", "Año", "年", "År", "Jahr", "Год", "Année"],
  ["Current week leader", "متصدر الأسبوع الحالي", "Líder actual de la semana", "本周当前领先者", "Veckans nuvarande ledare", "Aktueller Wochenführer", "Текущий лидер недели", "Leader actuel de la semaine"],
  ["Current overall lead", "الصدارة العامة الحالية", "Liderato general actual", "当前总榜领先", "Nuvarande totalledning", "Aktuelle Gesamtführung", "Текущее общее лидерство", "Tête du classement général"],
  ["Highest normalized group score for the selected day.", "أعلى نتيجة جماعية موحّدة لليوم المحدد.", "Mayor puntuación normalizada del grupo en el día seleccionado.", "所选日期的最高群组标准化得分。", "Högsta normaliserade grupppoäng för den valda dagen.", "Höchster normalisierter Gruppenwert am ausgewählten Tag.", "Наивысший нормализованный групповой балл за выбранный день.", "Meilleur score de groupe normalisé pour le jour sélectionné."],
  ["Final overall winner", "الفائز العام النهائي", "Ganador general final", "最终总榜获胜者", "Slutlig totalvinnare", "Endgültiger Gesamtsieger", "Итоговый общий победитель", "Vainqueur final au classement général"],
  ["Highest normalized score on the day before the selected date.", "أعلى نتيجة موحّدة في اليوم السابق للتاريخ المحدد.", "Mayor puntuación normalizada del día anterior a la fecha seleccionada.", "所选日期前一天的最高标准化得分。", "Högsta normaliserade poäng dagen före det valda datumet.", "Höchster normalisierter Wert am Tag vor dem ausgewählten Datum.", "Наивысший нормализованный балл за день до выбранной даты.", "Meilleur score normalisé la veille de la date sélectionnée."],
  ["Best score this week", "أفضل نتيجة هذا الأسبوع", "Mejor puntuación de la semana", "本周最佳得分", "Veckans bästa poäng", "Bester Wert dieser Woche", "Лучший балл недели", "Meilleur score de la semaine"],
  ["Highest average normalized score in the current calendar week.", "أعلى متوسط نتيجة موحّدة في أسبوع التقويم الحالي.", "Mayor puntuación media normalizada de la semana natural actual.", "当前自然周的最高平均标准化得分。", "Högsta genomsnittliga normaliserade poäng under aktuell kalendervecka.", "Höchster durchschnittlicher normalisierter Wert in der aktuellen Kalenderwoche.", "Наивысший средний нормализованный балл за текущую календарную неделю.", "Meilleur score normalisé moyen de la semaine calendaire en cours."],
  ["Current monthly lead", "صدارة الشهر الحالية", "Liderato mensual actual", "当前月度领先", "Nuvarande månadsledning", "Aktuelle Monatsführung", "Текущее лидерство месяца", "Tête du classement mensuel"],
  ["Highest average normalized score in the selected month.", "أعلى متوسط نتيجة موحّدة في الشهر المحدد.", "Mayor puntuación media normalizada del mes seleccionado.", "所选月份的最高平均标准化得分。", "Högsta genomsnittliga normaliserade poäng under vald månad.", "Höchster durchschnittlicher normalisierter Wert im ausgewählten Monat.", "Наивысший средний нормализованный балл за выбранный месяц.", "Meilleur score normalisé moyen du mois sélectionné."],
  ["Current yearly lead", "صدارة السنة الحالية", "Liderato anual actual", "当前年度领先", "Nuvarande årsledning", "Aktuelle Jahresführung", "Текущее лидерство года", "Tête du classement annuel"],
  ["Highest average normalized score in the selected calendar year.", "أعلى متوسط نتيجة موحّدة في السنة التقويمية المحددة.", "Mayor puntuación media normalizada del año natural seleccionado.", "所选自然年的最高平均标准化得分。", "Högsta genomsnittliga normaliserade poäng under valt kalenderår.", "Höchster durchschnittlicher normalisierter Wert im ausgewählten Kalenderjahr.", "Наивысший средний нормализованный балл за выбранный календарный год.", "Meilleur score normalisé moyen de l’année civile sélectionnée."],
  ["Largest three-day score improvement versus the prior three days.", "أكبر تحسن في النتيجة خلال ثلاثة أيام مقارنة بالأيام الثلاثة السابقة.", "Mayor mejora de puntuación en tres días frente a los tres días anteriores.", "与前三天相比，三天内得分提升最大。", "Största poängförbättringen under tre dagar jämfört med de tre föregående.", "Größte Wertverbesserung über drei Tage gegenüber den drei vorherigen Tagen.", "Наибольшее улучшение балла за три дня по сравнению с предыдущими тремя днями.", "Plus forte amélioration du score sur trois jours par rapport aux trois jours précédents."],
  ["Logged food and stayed at or below 50g of carbohydrates on all seven days.", "تم تسجيل الطعام والبقاء عند 50 غ من الكربوهيدرات أو أقل في الأيام السبعة كلها.", "Registró alimentos y se mantuvo en 50 g de carbohidratos o menos durante los siete días.", "连续七天记录饮食，且每天碳水化合物不超过 50 克。", "Mat loggades och kolhydraterna hölls på högst 50 g under alla sju dagar.", "An allen sieben Tagen Essen protokolliert und höchstens 50 g Kohlenhydrate aufgenommen.", "Питание записывалось все семь дней, а углеводы не превышали 50 г в день.", "Alimentation enregistrée et glucides maintenus à 50 g ou moins pendant les sept jours."],
  ["Highest streak tier reached.", "تم بلوغ أعلى مستوى للسلسلة.", "Se alcanzó el nivel de racha más alto.", "已达到最高连续等级。", "Högsta svitnivån är nådd.", "Höchste Serienstufe erreicht.", "Достигнут высший уровень серии.", "Niveau de série maximal atteint."],
  ["YOUR 7-DAY RECAP", "ملخصك لسبعة أيام", "TU RESUMEN DE 7 DÍAS", "你的 7 天回顾", "DIN 7-DAGARSÖVERSIKT", "DEIN 7-TAGE-RÜCKBLICK", "ВАШИ ИТОГИ ЗА 7 ДНЕЙ", "VOTRE BILAN SUR 7 JOURS"],
  ["You kept moving", "واصلت الحركة", "Seguiste en movimiento", "你一直在动", "Du fortsatte röra på dig", "Du bist in Bewegung geblieben", "Вы продолжали двигаться", "Vous êtes resté en mouvement"],
  ["DISTANCE UNLOCKED", "المسافة المحققة", "DISTANCIA ALCANZADA", "解锁里程", "UPPNÅDD STRÄCKA", "ERREICHTE DISTANZ", "ПРОЙДЕННАЯ ДИСТАНЦИЯ", "DISTANCE PARCOURUE"],
  ["Put it in perspective", "ضعها في منظورها", "Ponlo en perspectiva", "换个角度看", "Sätt det i perspektiv", "Setze es ins Verhältnis", "Взгляните в масштабе", "Mettez-le en perspective"],
  ["GOAL CHECK", "مراجعة الأهداف", "REVISIÓN DE OBJETIVOS", "目标回顾", "MÅLKOLL", "ZIELCHECK", "ПРОВЕРКА ЦЕЛЕЙ", "BILAN DES OBJECTIFS"],
  ["Perfect days happened", "حققت أيامًا مثالية", "Hubo días perfectos", "你达成了完美日", "Du fick perfekta dagar", "Du hattest perfekte Tage", "У вас были идеальные дни", "Vous avez réussi des journées parfaites"],
  ["Every check counts", "كل متابعة تُحتسب", "Cada registro cuenta", "每次记录都算数", "Varje avstämning räknas", "Jeder Eintrag zählt", "Каждая отметка важна", "Chaque suivi compte"],
  ["BEST DAY", "أفضل يوم", "MEJOR DÍA", "最佳一天", "BÄSTA DAG", "BESTER TAG", "ЛУЧШИЙ ДЕНЬ", "MEILLEURE JOURNÉE"],
  ["Your highest configured HabHub score in this recap window.", "أعلى نتيجة HabHub مضبوطة لك خلال فترة الملخص هذه.", "Tu mayor puntuación configurada de HabHub en este periodo de resumen.", "本次回顾期间你的最高 HabHub 配置得分。", "Din högsta konfigurerade HabHub-poäng under den här perioden.", "Dein höchster konfigurierter HabHub-Wert in diesem Rückblick.", "Ваш наивысший настроенный балл HabHub за этот период.", "Votre meilleur score HabHub configuré sur cette période."],
  ["ACTIVE ENERGY", "الطاقة النشطة", "ENERGÍA ACTIVA", "活动能量", "AKTIV ENERGI", "AKTIVE ENERGIE", "АКТИВНАЯ ЭНЕРГИЯ", "ÉNERGIE ACTIVE"],
  ["Energy invested", "الطاقة المبذولة", "Energía invertida", "投入的能量", "Investerad energi", "Eingesetzte Energie", "Затраченная энергия", "Énergie dépensée"],
  ["Total logged active energy across your last seven days.", "إجمالي الطاقة النشطة المسجلة خلال الأيام السبعة الماضية.", "Energía activa total registrada durante tus últimos siete días.", "过去七天记录的活动能量总计。", "Total loggad aktiv energi under dina senaste sju dagar.", "Gesamte protokollierte aktive Energie der letzten sieben Tage.", "Общая активная энергия, записанная за последние семь дней.", "Énergie active totale enregistrée sur vos sept derniers jours."],
  ["NUTRITION RHYTHM", "نمط التغذية", "RITMO NUTRICIONAL", "饮食节奏", "KOSTRYTM", "ERNÄHRUNGSRHYTHMUS", "РИТМ ПИТАНИЯ", "RYTHME ALIMENTAIRE"],
  ["Your daily average", "متوسطك اليومي", "Tu media diaria", "你的每日平均值", "Ditt dagsgenomsnitt", "Dein Tagesdurchschnitt", "Ваш средний показатель за день", "Votre moyenne quotidienne"],
  ["Your activity-adjusted allowance is evaluated separately on each day.", "يُقيَّم حدك المعدّل حسب النشاط بشكل منفصل لكل يوم.", "Tu límite ajustado por actividad se evalúa por separado cada día.", "每天会单独评估按活动调整后的额度。", "Ditt aktivitetsjusterade utrymme bedöms separat för varje dag.", "Dein aktivitätsangepasster Spielraum wird für jeden Tag separat bewertet.", "Лимит с учётом активности оценивается отдельно для каждого дня.", "Votre marge ajustée selon l’activité est évaluée séparément chaque jour."],
  ["PROTEIN CHECK", "مراجعة البروتين", "REVISIÓN DE PROTEÍNAS", "蛋白质回顾", "PROTEINKOLL", "PROTEINCHECK", "ПРОВЕРКА БЕЛКА", "BILAN DES PROTÉINES"],
  ["Weekly average", "المتوسط الأسبوعي", "Media semanal", "周平均值", "Veckogenomsnitt", "Wochendurchschnitt", "Среднее за неделю", "Moyenne hebdomadaire"],
  ["A simple look at consistency—not a medical recommendation.", "نظرة بسيطة على الاستمرارية، وليست توصية طبية.", "Una visión sencilla de la constancia, no una recomendación médica.", "用于简单查看规律性，并非医疗建议。", "En enkel bild av regelbundenheten – inte medicinsk rådgivning.", "Ein einfacher Blick auf die Regelmäßigkeit – keine medizinische Empfehlung.", "Простой обзор регулярности, а не медицинская рекомендация.", "Un simple aperçu de la régularité, pas une recommandation médicale."],
  ["SHOWING UP", "الاستمرارية", "CONSTANCIA", "坚持参与", "ATT VARA MED", "DRANBLEIBEN", "РЕГУЛЯРНОСТЬ", "RÉGULARITÉ"],
  ["Seven days, one story", "سبعة أيام، قصة واحدة", "Siete días, una historia", "七天，一段历程", "Sju dagar, en berättelse", "Sieben Tage, eine Geschichte", "Семь дней — одна история", "Sept jours, une histoire"],
  ["Your average configured score for this rolling week.", "متوسط نتيجتك المضبوطة لهذا الأسبوع المتحرك.", "Tu puntuación media configurada para esta semana móvil.", "本滚动周的平均配置得分。", "Din genomsnittliga konfigurerade poäng för den rullande veckan.", "Dein durchschnittlicher konfigurierter Wert für diese rollierende Woche.", "Ваш средний настроенный балл за скользящую неделю.", "Votre score configuré moyen pour cette semaine glissante."],
  ["BIGGEST STRENGTH", "أكبر نقطة قوة", "MAYOR FORTALEZA", "最大优势", "STÖRSTA STYRKA", "GRÖSSTE STÄRKE", "ГЛАВНАЯ СИЛЬНАЯ СТОРОНА", "PRINCIPAL POINT FORT"],
  ["Your strongest goal-aligned area compared with your other selected trackers.", "أقوى مجال متوافق مع أهدافك مقارنة بالمؤشرات الأخرى المحددة.", "Tu área más sólida respecto al objetivo frente a los otros indicadores seleccionados.", "与其他所选追踪项相比，这是你最符合目标的优势领域。", "Ditt starkaste målrelaterade område jämfört med övriga valda spårare.", "Dein stärkster zielbezogener Bereich im Vergleich zu deinen anderen ausgewählten Trackern.", "Самая сильная область по достижению цели среди выбранных показателей.", "Votre domaine le plus performant par rapport à l’objectif parmi les suivis sélectionnés."],
  ["NEXT BEST WIN", "أفضل فرصة تالية", "PRÓXIMA MEJOR OPORTUNIDAD", "下一个最佳突破点", "NÄSTA BÄSTA VINST", "NÄCHSTER GUTER ERFOLG", "СЛЕДУЮЩАЯ ЛУЧШАЯ ВОЗМОЖНОСТЬ", "PROCHAINE MEILLEURE OPPORTUNITÉ"],
  ["Focus here", "ركّز هنا", "Céntrate aquí", "重点关注这里", "Fokusera här", "Hier fokussieren", "Сосредоточьтесь здесь", "Concentrez-vous ici"],
  ["This has the most room to improve based on your recent goal progress.", "هذا المجال يملك أكبر فرصة للتحسن استنادًا إلى تقدم أهدافك الأخير.", "Aquí hay más margen de mejora según tu progreso reciente hacia los objetivos.", "根据你近期的目标进展，这里最有提升空间。", "Här finns störst förbättringsutrymme utifrån dina senaste målframsteg.", "Hier besteht anhand deines jüngsten Zielfortschritts das größte Verbesserungspotenzial.", "Здесь больше всего возможностей для улучшения с учётом недавнего прогресса.", "C’est le domaine offrant la plus grande marge d’amélioration selon vos progrès récents."],
  ["Highest average configured group score over the last seven days.", "أعلى متوسط نتيجة جماعية مضبوطة خلال الأيام السبعة الماضية.", "Mayor puntuación media configurada del grupo durante los últimos siete días.", "过去七天最高的群组平均配置得分。", "Högsta genomsnittliga konfigurerade grupppoäng under de senaste sju dagarna.", "Höchster durchschnittlicher konfigurierter Gruppenwert der letzten sieben Tage.", "Наивысший средний настроенный групповой балл за последние семь дней.", "Meilleur score de groupe configuré moyen sur les sept derniers jours."],
  ["Best daily average across the current seven-day recap.", "أفضل متوسط يومي خلال ملخص الأيام السبعة الحالي.", "Mejor media diaria del resumen actual de siete días.", "当前七天回顾中的最佳日均值。", "Bästa dagsgenomsnitt i den aktuella sjudagarsöversikten.", "Bester Tagesdurchschnitt im aktuellen Sieben-Tage-Rückblick.", "Лучший средний дневной результат за текущие семь дней.", "Meilleure moyenne quotidienne du bilan actuel sur sept jours."],
  ["TOGETHER", "معًا", "JUNTOS", "一起", "TILLSAMMANS", "GEMEINSAM", "ВМЕСТЕ", "ENSEMBLE"],
  ["The group went far", "قطعت المجموعة مسافة كبيرة", "El grupo llegó lejos", "群组走了很远", "Gruppen tog sig långt", "Die Gruppe ist weit gekommen", "Группа прошла большой путь", "Le groupe est allé loin"],
  ["COMEBACK ENERGY", "طاقة العودة", "ENERGÍA DE REMONTADA", "逆袭能量", "COMEBACK-ENERGI", "COMEBACK-ENERGIE", "ЭНЕРГИЯ ВОЗВРАЩЕНИЯ", "ÉNERGIE DU RETOUR"],
  ["Largest score change compared with the previous seven days.", "أكبر تغير في النتيجة مقارنة بالأيام السبعة السابقة.", "Mayor cambio de puntuación frente a los siete días anteriores.", "与前七天相比，得分变化最大。", "Största poängförändringen jämfört med de föregående sju dagarna.", "Größte Wertänderung gegenüber den vorherigen sieben Tagen.", "Наибольшее изменение балла по сравнению с предыдущими семью днями.", "Plus forte variation du score par rapport aux sept jours précédents."],
  ["KEEP IT FRIENDLY", "حافظ على روح الود", "COMPITE CON BUEN ESPÍRITU", "友好竞技", "HÅLL DET VÄNSKAPLIGT", "FAIR BLEIBEN", "ДРУЖЕСКОЕ СОРЕВНОВАНИЕ", "RESTEZ BON JOUEUR"],
  ["The board resets every day", "تُعاد لوحة الترتيب كل يوم", "La clasificación se reinicia cada día", "排行榜每天重置", "Topplistan återställs varje dag", "Die Rangliste startet jeden Tag neu", "Рейтинг обновляется каждый день", "Le classement repart chaque jour"],
  ["Cheer a win, share the work, and keep the competition moving.", "شجّع الفوز وشارك الجهد وحافظ على استمرار المنافسة.", "Celebra una victoria, comparte el esfuerzo y mantén viva la competición.", "为胜利喝彩、分享努力，让竞争继续。", "Fira en vinst, dela arbetet och håll tävlingen igång.", "Feiere Erfolge, teile den Einsatz und halte den Wettbewerb in Bewegung.", "Поддерживайте победы, делитесь усилиями и продолжайте соревнование.", "Célébrez les victoires, partagez les efforts et faites vivre la compétition."],
  ["Workout · shared group exercise using one stable comparison key.", "التمرين · تمرين جماعي مشترك يستخدم مفتاح مقارنة ثابتًا واحدًا.", "Entrenamiento · ejercicio compartido por el grupo con una única clave de comparación estable.", "锻炼 · 使用一个稳定比较键的群组共享动作。", "Träning · delad gruppövning med en stabil jämförelsenyckel.", "Training · geteilte Gruppenübung mit einem stabilen Vergleichsschlüssel.", "Тренировка · общее групповое упражнение с единым постоянным ключом сравнения.", "Entraînement · exercice partagé par le groupe avec une clé de comparaison stable."],
  ["Workout · completed repetitions; compatible native exercise segments sync when exposed.", "التمرين · التكرارات المكتملة؛ تتم مزامنة مقاطع التمرين الأصلية المتوافقة عند توفرها.", "Entrenamiento · repeticiones completadas; los segmentos nativos compatibles se sincronizan cuando están disponibles.", "锻炼 · 已完成的重复次数；兼容的原生动作分段可用时会同步。", "Träning · slutförda repetitioner; kompatibla inbyggda träningssegment synkas när de är tillgängliga.", "Training · abgeschlossene Wiederholungen; kompatible native Übungssegmente werden synchronisiert, wenn sie verfügbar sind.", "Тренировка · выполненные повторения; совместимые нативные сегменты упражнений синхронизируются, когда доступны.", "Entraînement · répétitions effectuées ; les segments d’exercice natifs compatibles sont synchronisés lorsqu’ils sont disponibles."],
  ["Workout · estimated one-rep max from HabHub sets; connected health does not expose lifted weight.", "التمرين · الحد الأقصى التقديري لتكرار واحد من مجموعات HabHub؛ لا تعرض خدمة الصحة المتصلة الوزن المرفوع.", "Entrenamiento · máximo estimado para una repetición a partir de las series de HabHub; la salud conectada no proporciona el peso levantado.", "锻炼 · 根据 HabHub 组数估算一次最大重量；已连接的健康服务不提供举重重量。", "Träning · uppskattat max för en repetition från HabHub-set; ansluten hälsa visar inte lyft vikt.", "Training · geschätztes Ein-Wiederholungs-Maximum aus HabHub-Sätzen; verbundene Gesundheitsdienste liefern kein gehobenes Gewicht.", "Тренировка · расчётный максимум на одно повторение по подходам HabHub; подключённые сервисы здоровья не передают поднятый вес.", "Entraînement · maximum estimé sur une répétition d’après les séries HabHub ; les services de santé connectés ne fournissent pas la charge soulevée."],
  ["Workout · native repetition segments when exposed; lifted weight remains an in-app log.", "التمرين · مقاطع التكرارات الأصلية عند توفرها؛ يظل الوزن المرفوع سجلًا داخل التطبيق.", "Entrenamiento · segmentos nativos de repeticiones cuando están disponibles; el peso levantado se registra en la aplicación.", "锻炼 · 可用时同步原生重复次数分段；举重重量仍需在应用内记录。", "Träning · inbyggda repetitionssegment när de är tillgängliga; lyft vikt loggas fortsatt i appen.", "Training · native Wiederholungssegmente, sofern verfügbar; gehobenes Gewicht bleibt ein Eintrag in der App.", "Тренировка · нативные сегменты повторений, когда доступны; поднятый вес остаётся записью внутри приложения.", "Entraînement · segments natifs de répétitions lorsqu’ils sont disponibles ; la charge soulevée reste enregistrée dans l’application."],
  ["Workout · completed at least one set in this session.", "التمرين · اكتملت مجموعة واحدة على الأقل في هذه الجلسة.", "Entrenamiento · se completó al menos una serie en esta sesión.", "锻炼 · 本次训练已完成至少一组。", "Träning · minst ett set slutfördes under passet.", "Training · in dieser Einheit wurde mindestens ein Satz abgeschlossen.", "Тренировка · в этой сессии выполнен хотя бы один подход.", "Entraînement · au moins une série a été effectuée pendant cette séance."],
  ["Workout · total saved session duration for the day.", "التمرين · إجمالي مدة الجلسات المحفوظة لهذا اليوم.", "Entrenamiento · duración total de las sesiones guardadas del día.", "锻炼 · 当天已保存训练的总时长。", "Träning · total längd för dagens sparade pass.", "Training · Gesamtdauer der gespeicherten Einheiten des Tages.", "Тренировка · общая длительность сохранённых сессий за день.", "Entraînement · durée totale des séances enregistrées pour la journée."],
  ["Workout · total completed reps × external load for the day.", "التمرين · إجمالي التكرارات المكتملة × الحمل الخارجي لليوم.", "Entrenamiento · repeticiones completadas totales × carga externa del día.", "锻炼 · 当天完成的总次数 × 外部负重。", "Träning · dagens totala slutförda repetitioner × yttre belastning.", "Training · gesamte abgeschlossene Wiederholungen × externe Last des Tages.", "Тренировка · общее число выполненных повторений × внешний вес за день.", "Entraînement · total des répétitions effectuées × charge externe de la journée."],
  ["Workout · completed sets across all exercises for the day.", "التمرين · المجموعات المكتملة في جميع تمارين اليوم.", "Entrenamiento · series completadas en todos los ejercicios del día.", "锻炼 · 当天所有动作已完成的组数。", "Träning · slutförda set i dagens samtliga övningar.", "Training · abgeschlossene Sätze über alle Übungen des Tages.", "Тренировка · выполненные подходы во всех упражнениях за день.", "Entraînement · séries effectuées sur tous les exercices de la journée."],
  ["Workout · standardized completed-set volume for this muscle group.", "التمرين · حجم موحّد للمجموعات المكتملة لهذه المجموعة العضلية.", "Entrenamiento · volumen estandarizado de series completadas para este grupo muscular.", "锻炼 · 此肌群已完成组数的标准化训练容量。", "Träning · standardiserad volym för slutförda set i denna muskelgrupp.", "Training · standardisiertes Volumen abgeschlossener Sätze für diese Muskelgruppe.", "Тренировка · стандартизированный объём выполненных подходов для этой группы мышц.", "Entraînement · volume standardisé des séries effectuées pour ce groupe musculaire."],
  ["Rest timing is now included in your workout and calorie estimate.", "أصبح توقيت الراحة الآن ضمن تقدير التمرين والسعرات الحرارية.", "El tiempo de descanso ya se incluye en la estimación del entrenamiento y las calorías.", "休息时间现已计入锻炼和热量估算。", "Vilotiden ingår nu i uppskattningen av träningen och kalorierna.", "Die Pausenzeiten fließen jetzt in die Trainings- und Kalorienschätzung ein.", "Время отдыха теперь учитывается при оценке тренировки и калорий.", "Le temps de repos est désormais pris en compte dans l’estimation de l’entraînement et des calories."],
  ["Strength", "القوة", "Fuerza", "力量", "Styrka", "Kraft", "Силовые упражнения", "Force"],
  ["Cardio", "تمارين القلب", "Cardio", "有氧运动", "Kondition", "Cardio", "Кардио", "Cardio"],
  ["Conditioning", "اللياقة البدنية", "Acondicionamiento", "体能训练", "Fysisk träning", "Konditionierung", "Функциональная подготовка", "Conditionnement"],
  ["Mobility & recovery", "الحركة والتعافي", "Movilidad y recuperación", "活动度与恢复", "Rörlighet och återhämtning", "Mobilität und Erholung", "Подвижность и восстановление", "Mobilité et récupération"],
  ["Mind & body", "العقل والجسم", "Mente y cuerpo", "身心运动", "Kropp och sinne", "Körper und Geist", "Разум и тело", "Corps et esprit"],
  ["Team sports", "الرياضات الجماعية", "Deportes de equipo", "团队运动", "Lagsporter", "Mannschaftssport", "Командные виды спорта", "Sports collectifs"],
  ["Racket sports", "رياضات المضرب", "Deportes de raqueta", "球拍运动", "Racketsporter", "Schlägersport", "Ракеточные виды спорта", "Sports de raquette"],
  ["Combat sports", "الرياضات القتالية", "Deportes de combate", "格斗运动", "Kampsporter", "Kampfsport", "Единоборства", "Sports de combat"],
  ["Outdoor", "أنشطة خارجية", "Aire libre", "户外运动", "Utomhus", "Outdoor", "На открытом воздухе", "Plein air"],
  ["Water sports", "الرياضات المائية", "Deportes acuáticos", "水上运动", "Vattensporter", "Wassersport", "Водные виды спорта", "Sports nautiques"],
  ["Snow & ice", "رياضات الثلج والجليد", "Nieve y hielo", "冰雪运动", "Snö och is", "Schnee und Eis", "Снег и лёд", "Neige et glace"],
  ["Multisport", "رياضات متعددة", "Multideporte", "多项运动", "Multisport", "Multisport", "Мультиспорт", "Multisport"],
  ["Other activities", "أنشطة أخرى", "Otras actividades", "其他活动", "Andra aktiviteter", "Andere Aktivitäten", "Другие активности", "Autres activités"],
] satisfies readonly Row[];

const socialRows = [
  ["Nice work!", "عمل رائع!", "¡Buen trabajo!", "做得好！", "Bra jobbat!", "Starke Leistung!", "Отличная работа!", "Beau travail !"],
  ["That is momentum.", "هذا هو الزخم.", "Eso es impulso.", "这就是势头。", "Det är framåtdriv.", "Das ist Schwung.", "Вот это темп.", "Voilà une belle dynamique."],
  ["Big win!", "فوز كبير!", "¡Gran victoria!", "重大胜利！", "Stor vinst!", "Großer Erfolg!", "Большая победа!", "Belle victoire !"],
  ["You showed up.", "لقد التزمت.", "Has cumplido.", "你做到了。", "Du dök upp.", "Du warst da.", "Вы не пропустили.", "Vous avez répondu présent."],
  ["Strong move!", "خطوة قوية!", "¡Buen movimiento!", "干得漂亮！", "Starkt jobbat!", "Starker Zug!", "Сильный ход!", "Beau geste !"],
  ["Look at you go!", "انظر إلى تقدمك!", "¡Mira cómo avanzas!", "看看你的进步！", "Se dig köra!", "Schau, wie du loslegst!", "Вот это прогресс!", "Regardez-vous avancer !"],
  ["One more step toward the goal", "خطوة أخرى نحو الهدف", "Un paso más hacia el objetivo", "离目标又近一步", "Ett steg närmare målet", "Ein Schritt näher am Ziel", "Ещё один шаг к цели", "Un pas de plus vers l’objectif"],
  ["Consistency is doing its thing", "الاستمرارية تؤتي ثمارها", "La constancia está dando resultado", "坚持正在发挥作用", "Konsekvensen ger resultat", "Beständigkeit zahlt sich aus", "Постоянство работает", "La régularité porte ses fruits"],
  ["The group noticed that effort", "لاحظت المجموعة هذا الجهد", "El grupo ha notado ese esfuerzo", "群组看到了你的努力", "Gruppen såg din insats", "Die Gruppe hat deinen Einsatz bemerkt", "Группа заметила ваши усилия", "Le groupe a remarqué cet effort"],
  ["Today just got better", "أصبح اليوم أفضل", "El día acaba de mejorar", "今天变得更好了", "Dagen blev just bättre", "Der Tag wurde gerade besser", "Этот день стал лучше", "La journée vient de s’améliorer"],
  ["That goal is getting nervous", "بدأ الهدف يقلق", "Ese objetivo empieza a preocuparse", "目标开始紧张了", "Målet börjar bli nervöst", "Das Ziel wird nervös", "Цель уже нервничает", "Cet objectif commence à trembler"],
  ["Keep stacking the small wins", "واصل جمع الانتصارات الصغيرة", "Sigue sumando pequeñas victorias", "继续积累小胜利", "Fortsätt samla små vinster", "Sammle weiter kleine Erfolge", "Продолжайте копить маленькие победы", "Continuez à cumuler les petites victoires"],
  ["Keep going 💚", "واصل التقدم 💚", "Sigue así 💚", "继续加油 💚", "Fortsätt 💚", "Weiter so 💚", "Продолжайте 💚", "Continuez 💚"],
  ["We are cheering for you.", "نحن نشجعك.", "Te estamos animando.", "我们在为你加油。", "Vi hejar på dig.", "Wir feuern dich an.", "Мы болеем за вас.", "Nous vous encourageons."],
  ["Onward!", "إلى الأمام!", "¡Adelante!", "继续前进！", "Framåt!", "Weiter!", "Вперёд!", "En avant !"],
  ["That counts.", "هذا يُحتسب.", "Eso cuenta.", "这也算数。", "Det räknas.", "Das zählt.", "Это считается.", "Ça compte."],
  ["Proud of you!", "فخورون بك!", "¡Estamos orgullosos de ti!", "为你骄傲！", "Stolt över dig!", "Stolz auf dich!", "Мы гордимся вами!", "Fiers de vous !"],
  ["Friendly warning:", "تحذير ودي:", "Aviso amistoso:", "友情提醒：", "Vänlig varning:", "Freundliche Warnung:", "Дружеское предупреждение:", "Petit avertissement :"],
  ["Leaderboard update:", "تحديث لوحة الصدارة:", "Actualización de la clasificación:", "排行榜更新：", "Topplisteuppdatering:", "Ranglisten-Update:", "Обновление рейтинга:", "Mise à jour du classement :"],
  ["No pressure, but", "لا نريد الضغط عليك، لكن", "Sin presión, pero", "没有压力，不过", "Ingen press, men", "Kein Druck, aber", "Без давления, но", "Sans pression, mais"],
  ["Just checking:", "مجرد سؤال:", "Solo comprobamos:", "问一下：", "Kollar bara:", "Nur kurz gefragt:", "Просто проверяем:", "Juste une vérification :"],
  ["Breaking news:", "خبر عاجل:", "Última hora:", "突发消息：", "Senaste nytt:", "Eilmeldung:", "Срочные новости:", "Dernière minute :"],
  ["Tiny challenge:", "تحدٍ صغير:", "Pequeño reto:", "小挑战：", "Liten utmaning:", "Kleine Herausforderung:", "Небольшой вызов:", "Petit défi :"],
  ["your spot is not reserved", "مكانك غير محجوز", "tu puesto no está reservado", "你的位置可不是固定的", "din plats är inte reserverad", "dein Platz ist nicht reserviert", "ваше место не забронировано", "votre place n’est pas réservée"],
  ["the group is moving while you read this", "المجموعة تتقدم وأنت تقرأ هذا", "el grupo avanza mientras lees esto", "你看这句话时群组还在前进", "gruppen rör sig medan du läser", "die Gruppe bewegt sich, während du das liest", "группа движется, пока вы это читаете", "le groupe avance pendant que vous lisez"],
  ["someone is eyeing your rank", "هناك من يراقب ترتيبك", "alguien tiene el ojo puesto en tu puesto", "有人盯上了你的排名", "någon siktar på din placering", "jemand hat deinen Rang im Blick", "кто-то нацелился на ваше место", "quelqu’un vise votre classement"],
  ["your step counter looks a little too relaxed", "عداد خطواتك يبدو مسترخياً أكثر من اللازم", "tu contador de pasos está demasiado relajado", "你的步数计似乎太放松了", "din stegräknare ser lite för avslappnad ut", "dein Schrittzähler wirkt etwas zu entspannt", "ваш шагомер слишком расслабился", "votre compteur de pas semble un peu trop détendu"],
  ["the comeback window is officially open", "فرصة العودة مفتوحة رسمياً", "la ventana de remontada está oficialmente abierta", "翻盘机会正式开启", "comeback-fönstret är officiellt öppet", "das Comeback-Fenster ist offiziell offen", "окно для возвращения официально открыто", "la fenêtre du retour est officiellement ouverte"],
  ["the podium would like a word", "منصة التتويج تريد التحدث إليك", "el podio quiere hablar contigo", "领奖台有话对你说", "pallen vill prata med dig", "das Podium möchte ein Wort mit dir", "пьедестал хочет поговорить", "le podium aimerait vous parler"],
  ["Your move 😄", "دورك 😄", "Te toca 😄", "该你了 😄", "Ditt drag 😄", "Du bist dran 😄", "Ваш ход 😄", "À vous de jouer 😄"],
  ["Time to answer.", "حان وقت الرد.", "Hora de responder.", "该回应了。", "Dags att svara.", "Zeit zu antworten.", "Пора ответить.", "À vous de répondre."],
  ["Show us what you have.", "أرنا ما لديك.", "Muéstranos lo que tienes.", "让我们看看你的实力。", "Visa vad du kan.", "Zeig uns, was du kannst.", "Покажите, на что вы способны.", "Montrez-nous ce que vous avez."],
  ["Catch us if you can.", "الحق بنا إن استطعت.", "Alcánzanos si puedes.", "有本事就追上来。", "Kom ikapp om du kan.", "Hol uns ein, wenn du kannst.", "Догоните нас, если сможете.", "Rattrapez-nous si vous pouvez."],
  ["Game on.", "بدأ التحدي.", "Que empiece el juego.", "比赛开始。", "Nu kör vi.", "Das Spiel läuft.", "Игра началась.", "Que le jeu commence."],
  ["Quick check-in:", "متابعة سريعة:", "Comprobación rápida:", "快速确认：", "Snabb avstämning:", "Kurzer Check-in:", "Быстрая проверка:", "Petit point rapide :"],
  ["Gentle nudge:", "تذكير لطيف:", "Pequeño empujón:", "温馨提醒：", "En vänlig puff:", "Sanfter Anstoß:", "Небольшое напоминание:", "Petit rappel :"],
  ["When you have a moment:", "عندما يتوفر لديك وقت:", "Cuando tengas un momento:", "有空时：", "När du har en stund:", "Wenn du einen Moment hast:", "Когда будет минутка:", "Quand vous aurez un moment :"],
  ["Today is still open:", "لا يزال اليوم متاحاً:", "El día aún no ha terminado:", "今天还没结束：", "Dagen är fortfarande öppen:", "Der Tag ist noch offen:", "День ещё не закончился:", "La journée n’est pas terminée :"],
  ["Small reminder:", "تذكير بسيط:", "Pequeño recordatorio:", "小提醒：", "Liten påminnelse:", "Kleine Erinnerung:", "Небольшое напоминание:", "Petit rappel :"],
  ["Before the day gets away:", "قبل أن ينتهي اليوم:", "Antes de que se acabe el día:", "趁今天还没过去：", "Innan dagen försvinner:", "Bevor der Tag vorbei ist:", "Пока день не закончился:", "Avant que la journée ne file :"],
  ["add the numbers you want to remember", "أضف الأرقام التي تريد تذكرها", "añade los datos que quieres recordar", "记录你想保留的数据", "lägg till siffrorna du vill minnas", "trage die Werte ein, die du behalten möchtest", "добавьте данные, которые хотите запомнить", "ajoutez les données à retenir"],
  ["your daily log is waiting", "سجلك اليومي ينتظرك", "tu registro diario te espera", "你的每日日志在等你", "din dagliga logg väntar", "dein Tagesprotokoll wartet", "ваш дневной журнал ждёт", "votre journal quotidien vous attend"],
  ["a ten-second update keeps the trend useful", "تحديث لعشر ثوانٍ يحافظ على فائدة الاتجاه", "diez segundos bastan para mantener útil la tendencia", "十秒更新即可让趋势保持有用", "tio sekunders uppdatering håller trenden användbar", "zehn Sekunden halten den Trend aussagekräftig", "десять секунд сохранят полезность графика", "dix secondes suffisent à garder une tendance utile"],
  ["record the win while it is fresh", "سجّل الإنجاز وهو حديث", "registra el logro mientras está reciente", "趁热记录这次成功", "logga vinsten medan den är färsk", "halte den Erfolg fest, solange er frisch ist", "запишите успех, пока он свеж", "notez la réussite pendant qu’elle est fraîche"],
  ["check your goals and log what matters", "راجع أهدافك وسجّل ما يهم", "revisa tus objetivos y registra lo importante", "检查目标并记录重要事项", "kolla dina mål och logga det viktiga", "prüfe deine Ziele und protokolliere, was zählt", "проверьте цели и запишите важное", "vérifiez vos objectifs et notez l’essentiel"],
  ["your future chart will thank you", "سيشكرك مخططك المستقبلي", "tu gráfico futuro te lo agradecerá", "未来的图表会感谢你", "din framtida graf kommer tacka dig", "dein zukünftiges Diagramm wird es dir danken", "ваш будущий график скажет спасибо", "votre futur graphique vous remerciera"],
  ["No rush.", "لا عجلة.", "Sin prisa.", "不用着急。", "Ingen brådska.", "Keine Eile.", "Без спешки.", "Rien ne presse."],
  ["You have got this.", "أنت قادر على ذلك.", "Puedes hacerlo.", "你能做到。", "Du klarar det.", "Du schaffst das.", "У вас получится.", "Vous pouvez le faire."],
  ["One tap is enough.", "نقرة واحدة تكفي.", "Un toque basta.", "点一下就够了。", "Ett tryck räcker.", "Ein Tipp genügt.", "Достаточно одного нажатия.", "Un geste suffit."],
  ["Keep it simple.", "أبقها بسيطة.", "Hazlo sencillo.", "保持简单。", "Håll det enkelt.", "Halte es einfach.", "Не усложняйте.", "Faites simple."],
  ["Done is better than perfect.", "الإنجاز أفضل من الكمال.", "Hecho es mejor que perfecto.", "完成胜过完美。", "Klart är bättre än perfekt.", "Erledigt ist besser als perfekt.", "Сделанное лучше идеального.", "Fait vaut mieux que parfait."],
  ["Be proud of the effort.", "افتخر بجهدك.", "Siéntete orgulloso del esfuerzo.", "为这份努力感到自豪。", "Var stolt över insatsen.", "Sei stolz auf deinen Einsatz.", "Гордитесь своим трудом.", "Soyez fier de l’effort."],
  ["No guilt if today is busy.", "لا تشعر بالذنب إذا كان يومك مشغولاً.", "No pasa nada si hoy estás ocupado.", "今天忙也不用自责。", "Ingen skuld om dagen är full.", "Kein schlechtes Gewissen, wenn heute viel los ist.", "Не вините себя, если день занят.", "Aucune culpabilité si la journée est chargée."],
  ["Now defend that rank.", "والآن دافع عن ترتيبك.", "Ahora defiende ese puesto.", "现在守住你的排名。", "Försvara nu placeringen.", "Verteidige jetzt deinen Rang.", "Теперь защитите это место.", "Maintenant, défendez ce rang."],
  ["The excuses leaderboard is already full.", "لوحة أعذار المنافسة ممتلئة بالفعل.", "La clasificación de excusas ya está llena.", "借口排行榜已经满员。", "Ursäktstopplistan är redan full.", "Die Ausreden-Rangliste ist schon voll.", "Рейтинг отговорок уже переполнен.", "Le classement des excuses est déjà complet."],
  ["The clock and leaderboard are both moving.", "الوقت ولوحة الصدارة يتحركان.", "El reloj y la clasificación siguen avanzando.", "时间和排行榜都在变化。", "Både klockan och topplistan rör sig.", "Uhr und Rangliste bewegen sich weiter.", "И часы, и рейтинг продолжают двигаться.", "L’horloge et le classement avancent."],
] satisfies readonly Row[];

const allExerciseRows = [...exerciseRows, ...expandedExerciseRows] as const;
const directRows = [...termRows, ...allExerciseRows, ...fixedRows, ...socialRows] as const;
const caseInsensitiveDomainNames = new Map(
  directRows.map((row) => [row[0].toLocaleLowerCase("en"), row[0]]),
);

const catalogs = Object.fromEntries(
  languages.map((language, index) => [
    language,
    Object.fromEntries(directRows.map((row) => [row[0], row[index + 1]])),
  ]),
) as Record<SecondaryLanguage, Record<string, string>>;

const canonicalMetricNames = new Set([
  ...termRows.map((row) => row[0]),
  ...allExerciseRows.map((row) => row[0]),
  "Reading",
  "Study",
  "Work",
]);
const caseInsensitiveMetricNames = new Map(
  [...canonicalMetricNames]
    .reverse()
    .map((name) => [name.toLocaleLowerCase("en"), name]),
);
const exerciseNames = new Set(allExerciseRows.map((row) => row[0]));
const translatedUnits = new Set([
  "steps", "kcal", "L", "kg", "g", "mg", "mcg", "min", "hr", "mmHg",
  "bpm", "km", "mg/dL", "day", "days", "pts", "sets", "reps", "s", "ml", "kg e1RM", "%", "1–4",
]);

const builtInIds = new Set([
  "steps", "food", "exercise", "deficit", "water", "workout", "weight", "protein",
  "fat", "carbs", "fiber", "sodium", "progress_photo", "workout_duration", "body_fat",
  "lean_body_mass", "body_water_mass", "bone_mass", "blood_pressure_systolic", "blood_pressure_diastolic", "pulse",
  "workout_calories", "workout_distance", "sugar", "saturated_fat", "cholesterol",
  "potassium", "calcium", "iron", "magnesium", "vitamin_c", "vitamin_d", "vitamin_b12",
  "weekly_deficit_balance", "sleep", "blood_glucose", "menstrual_cycle", "period_flow", "menstrual_flow",
  "cycle_symptoms", "cycle_day", "next_period_estimate", "days_until_period", "overall_score", "todos", "todo_completion",
  "gym_completed", "gym_duration", "gym_total_volume", "gym_completed_sets",
  "reading", "study", "work",
]);

function knownBuiltInId(id?: string) {
  if (!id) return false;
  if (builtInIds.has(id) || id.startsWith("gym_") || id.startsWith("workout_")) return true;
  return [...builtInIds].some((candidate) => new RegExp(`^${candidate}_[2-9]\\d*$`).test(id));
}

function direct(language: AppLanguage, value: string) {
  return language === "en" ? value : catalogs[language][value] ?? value;
}

/** Translate a built-in tracker name, but never an arbitrary user title. */
export function localizeMetricName(
  language: AppLanguage,
  metric: Pick<MetricDefinition, "id" | "name"> | { templateId?: string; id?: string; name: string },
) {
  if (language === "en") return metric.name;
  const id = "templateId" in metric ? metric.templateId ?? metric.id : metric.id;
  const recognizedName = knownBuiltInId(id) && canonicalMetricNames.has(metric.name);
  const gymGenerated =
    knownBuiltInId(id) &&
    /\s+(strength|volume|reps)$/i.test(metric.name) &&
    (exerciseNames.has(metric.name.replace(/\s+(strength|volume|reps)$/i, "")) ||
      [...new Set(termRows.slice(58, 70).map((row) => row[0]))].some((label) => metric.name === `${label} volume`));
  if (!recognizedName && !gymGenerated) return metric.name;
  return translateDomainText(language, metric.name);
}

/** Translate units only when attached to a recognized built-in tracker. */
export function localizeMetricUnit(
  language: AppLanguage,
  metric: Pick<MetricDefinition, "id" | "name" | "unit"> | { templateId?: string; id?: string; name: string; unit: string },
) {
  if (language === "en" || !metric.unit) return metric.unit;
  const id = "templateId" in metric ? metric.templateId ?? metric.id : metric.id;
  if (!knownBuiltInId(id) || !translatedUnits.has(metric.unit)) return metric.unit;
  return direct(language, metric.unit);
}

export function localizeSubmetricName(
  language: AppLanguage,
  parent: Pick<MetricDefinition, "id" | "name">,
  submetric: Pick<MetricSubmetric, "name">,
) {
  return knownBuiltInId(parent.id) && canonicalMetricNames.has(submetric.name)
    ? direct(language, submetric.name)
    : submetric.name;
}

export function localizeSubmetricUnit(
  language: AppLanguage,
  parent: Pick<MetricDefinition, "id" | "name">,
  submetric: Pick<MetricSubmetric, "unit">,
) {
  return knownBuiltInId(parent.id) && translatedUnits.has(submetric.unit)
    ? direct(language, submetric.unit)
    : submetric.unit;
}

export function localizeExerciseName(
  language: AppLanguage,
  exercise: { exerciseKey?: string; key?: string; name: string },
) {
  const key = exercise.exerciseKey ?? exercise.key;
  return key && !key.startsWith("custom:") && exerciseNames.has(exercise.name)
    ? direct(language, exercise.name)
    : exercise.name;
}

export function localizeMuscleLabel(language: AppLanguage, muscle: MuscleGroup) {
  const labels: Record<MuscleGroup, string> = {
    chest: "Chest", back: "Back", shoulders: "Shoulders", biceps: "Biceps",
    triceps: "Triceps", forearms: "Forearms", abs: "Core / abs", glutes: "Glutes",
    quadriceps: "Quadriceps", hamstrings: "Hamstrings", calves: "Calves", full_body: "Full body",
  };
  return direct(language, labels[muscle]);
}

type Template = {
  expression: RegExp;
  render: Record<SecondaryLanguage, (values: string[]) => string>;
};

const templates: Template[] = [
  template(/^now$/, {
    ar: () => "الآن", es: () => "ahora", "zh-Hans": () => "刚刚",
    sv: () => "nu", de: () => "jetzt", ru: () => "сейчас", fr: () => "à l’instant",
  }),
  template(/^(\d+)(s|m|h|d) ago$/, {
    ar: ([value, unit]) => `منذ ${value} ${unit === "s" ? "ثانية" : unit === "m" ? "دقيقة" : unit === "h" ? "ساعة" : "يوم"}`,
    es: ([value, unit]) => `hace ${value} ${unit === "s" ? "s" : unit === "m" ? "min" : unit === "h" ? "h" : "d"}`,
    "zh-Hans": ([value, unit]) => `${value}${unit === "s" ? "秒" : unit === "m" ? "分钟" : unit === "h" ? "小时" : "天"}前`,
    sv: ([value, unit]) => `för ${value} ${unit === "s" ? "s" : unit === "m" ? "min" : unit === "h" ? "tim" : "d"} sedan`,
    de: ([value, unit]) => `vor ${value} ${unit === "s" ? "Sek." : unit === "m" ? "Min." : unit === "h" ? "Std." : "Tg."}`,
    ru: ([value, unit]) => `${value} ${unit === "s" ? "с" : unit === "m" ? "мин" : unit === "h" ? "ч" : "дн."} назад`,
    fr: ([value, unit]) => `il y a ${value} ${unit === "s" ? "s" : unit === "m" ? "min" : unit === "h" ? "h" : "j"}`,
  }),
  template(/^Synced (.+)$/, {
    ar: ([when]) => `تمت المزامنة ${translateDomainText("ar", when)}`, es: ([when]) => `Sincronizado ${translateDomainText("es", when)}`,
    "zh-Hans": ([when]) => `已同步：${translateDomainText("zh-Hans", when)}`, sv: ([when]) => `Synkad ${translateDomainText("sv", when)}`,
    de: ([when]) => `Synchronisiert ${translateDomainText("de", when)}`, ru: ([when]) => `Синхронизировано ${translateDomainText("ru", when)}`,
    fr: ([when]) => `Synchronisé ${translateDomainText("fr", when)}`,
  }),
  template(/^Last synced(?: ·|:)? (.+)$/, {
    ar: ([when]) => `آخر مزامنة: ${translateDomainText("ar", when)}`, es: ([when]) => `Última sincronización: ${translateDomainText("es", when)}`,
    "zh-Hans": ([when]) => `上次同步：${translateDomainText("zh-Hans", when)}`, sv: ([when]) => `Senast synkad: ${translateDomainText("sv", when)}`,
    de: ([when]) => `Zuletzt synchronisiert: ${translateDomainText("de", when)}`, ru: ([when]) => `Последняя синхронизация: ${translateDomainText("ru", when)}`,
    fr: ([when]) => `Dernière synchronisation : ${translateDomainText("fr", when)}`,
  }),
  // Numeric progress copy such as "420 kcal left" or "2 goals left" must
  // mean "remaining". Keep it ahead of the later membership event pattern
  // ("Ahmad left") so Arabic and other languages never read this as a person
  // departing.
  template(/^No (.+?) reading for this day$/, {
    ar: ([name]) => `لا توجد قراءة ${localizeCaptured("ar", name)} لهذا اليوم`,
    es: ([name]) => `No hay ninguna lectura de ${localizeCaptured("es", name)} para este día`,
    "zh-Hans": ([name]) => `这一天没有${localizeCaptured("zh-Hans", name)}读数`,
    sv: ([name]) => `Ingen avläsning för ${localizeCaptured("sv", name)} den här dagen`,
    de: ([name]) => `Keine Messung für ${localizeCaptured("de", name)} an diesem Tag`,
    ru: ([name]) => `Нет показания «${localizeCaptured("ru", name)}» за этот день`,
    fr: ([name]) => `Aucune mesure de ${localizeCaptured("fr", name)} pour ce jour`,
  }),
  template(/^No (.+?) data for this day$/, {
    ar: ([name]) => `لا توجد بيانات ${localizeCaptured("ar", name)} لهذا اليوم`,
    es: ([name]) => `No hay datos de ${localizeCaptured("es", name)} para este día`,
    "zh-Hans": ([name]) => `这一天没有${localizeCaptured("zh-Hans", name)}数据`,
    sv: ([name]) => `Ingen data för ${localizeCaptured("sv", name)} den här dagen`,
    de: ([name]) => `Keine Daten für ${localizeCaptured("de", name)} an diesem Tag`,
    ru: ([name]) => `Нет данных «${localizeCaptured("ru", name)}» за этот день`,
    fr: ([name]) => `Aucune donnée de ${localizeCaptured("fr", name)} pour ce jour`,
  }),
  template(/^([\p{N}\d.,٬،]+(?:\s+[^\s]+)*) left$/u, {
    ar: ([value]) => `متبقٍ ${localizeCaptured("ar", value)}`,
    es: ([value]) => `Quedan ${localizeCaptured("es", value)}`,
    "zh-Hans": ([value]) => `还剩 ${localizeCaptured("zh-Hans", value)}`,
    sv: ([value]) => `${localizeCaptured("sv", value)} kvar`,
    de: ([value]) => `Noch ${localizeCaptured("de", value)}`,
    ru: ([value]) => `Осталось ${localizeCaptured("ru", value)}`,
    fr: ([value]) => `Il reste ${localizeCaptured("fr", value)}`,
  }),
  template(/^(.+?) remaining$/, {
    ar: ([value]) => `المتبقي ${localizeCaptured("ar", value)}`, es: ([value]) => `${localizeCaptured("es", value)} restantes`, "zh-Hans": ([value]) => `剩余 ${localizeCaptured("zh-Hans", value)}`,
    sv: ([value]) => `${localizeCaptured("sv", value)} återstår`, de: ([value]) => `${localizeCaptured("de", value)} verbleibend`, ru: ([value]) => `Осталось ${localizeCaptured("ru", value)}`, fr: ([value]) => `${localizeCaptured("fr", value)} restants`,
  }),
  template(/^(.+?) remaining · goal (.+?)( · activity-adjusted)?$/, {
    ar: ([value, goal, adjusted]) => `المتبقي ${localizeCaptured("ar", value)} · الهدف ${localizeCaptured("ar", goal)}${adjusted ? " · معدّل حسب النشاط" : ""}`,
    es: ([value, goal, adjusted]) => `${localizeCaptured("es", value)} restantes · objetivo ${localizeCaptured("es", goal)}${adjusted ? " · ajustado por actividad" : ""}`,
    "zh-Hans": ([value, goal, adjusted]) => `剩余 ${localizeCaptured("zh-Hans", value)} · 目标 ${localizeCaptured("zh-Hans", goal)}${adjusted ? " · 已按活动调整" : ""}`,
    sv: ([value, goal, adjusted]) => `${localizeCaptured("sv", value)} återstår · mål ${localizeCaptured("sv", goal)}${adjusted ? " · aktivitetsjusterat" : ""}`,
    de: ([value, goal, adjusted]) => `${localizeCaptured("de", value)} verbleibend · Ziel ${localizeCaptured("de", goal)}${adjusted ? " · aktivitätsbereinigt" : ""}`,
    ru: ([value, goal, adjusted]) => `Осталось ${localizeCaptured("ru", value)} · цель ${localizeCaptured("ru", goal)}${adjusted ? " · с учётом активности" : ""}`,
    fr: ([value, goal, adjusted]) => `${localizeCaptured("fr", value)} restants · objectif ${localizeCaptured("fr", goal)}${adjusted ? " · ajusté selon l’activité" : ""}`,
  }),
  template(/^(.+?) consumed · (.+?) remaining$/, {
    ar: ([used, left]) => `تم استهلاك ${used} · المتبقي ${left}`, es: ([used, left]) => `${used} consumidas · ${left} restantes`,
    "zh-Hans": ([used, left]) => `已摄入 ${used} · 剩余 ${left}`, sv: ([used, left]) => `${used} intaget · ${left} återstår`,
    de: ([used, left]) => `${used} verbraucht · ${left} verbleibend`, ru: ([used, left]) => `Употреблено ${used} · осталось ${left}`,
    fr: ([used, left]) => `${used} consommés · ${left} restants`,
  }),
  template(/^(.+?) consumed · allowance (.+?)$/, {
    ar: ([used, allowed]) => `تم استهلاك ${localizeCaptured("ar", used)} · المسموح ${localizeCaptured("ar", allowed)}`,
    es: ([used, allowed]) => `${localizeCaptured("es", used)} consumidas · límite ${localizeCaptured("es", allowed)}`,
    "zh-Hans": ([used, allowed]) => `已摄入 ${localizeCaptured("zh-Hans", used)} · 限额 ${localizeCaptured("zh-Hans", allowed)}`,
    sv: ([used, allowed]) => `${localizeCaptured("sv", used)} intaget · tillåtet ${localizeCaptured("sv", allowed)}`,
    de: ([used, allowed]) => `${localizeCaptured("de", used)} verbraucht · erlaubt ${localizeCaptured("de", allowed)}`,
    ru: ([used, allowed]) => `Употреблено ${localizeCaptured("ru", used)} · разрешено ${localizeCaptured("ru", allowed)}`,
    fr: ([used, allowed]) => `${localizeCaptured("fr", used)} consommés · limite ${localizeCaptured("fr", allowed)}`,
  }),
  template(/^Goal (.+?)$/, {
    ar: ([value]) => `الهدف ${localizeCaptured("ar", value)}`,
    es: ([value]) => `Objetivo ${localizeCaptured("es", value)}`,
    "zh-Hans": ([value]) => `目标 ${localizeCaptured("zh-Hans", value)}`,
    sv: ([value]) => `Mål ${localizeCaptured("sv", value)}`,
    de: ([value]) => `Ziel ${localizeCaptured("de", value)}`,
    ru: ([value]) => `Цель ${localizeCaptured("ru", value)}`,
    fr: ([value]) => `Objectif ${localizeCaptured("fr", value)}`,
  }),
  template(/^(\d+) of (\d+)$/, {
    ar: ([met, total]) => `${met} من ${total}`,
    es: ([met, total]) => `${met} de ${total}`,
    "zh-Hans": ([met, total]) => `${met}/${total}`,
    sv: ([met, total]) => `${met} av ${total}`,
    de: ([met, total]) => `${met} von ${total}`,
    ru: ([met, total]) => `${met} из ${total}`,
    fr: ([met, total]) => `${met} sur ${total}`,
  }),
  template(/^(\d+)% allowance used · (\d+)% remaining$/, {
    ar: ([used, left]) => `استُخدم ${used}٪ من المسموح · متبقٍ ${left}٪`, es: ([used, left]) => `${used} % del límite usado · ${left} % restante`,
    "zh-Hans": ([used, left]) => `已用额度 ${used}% · 剩余 ${left}%`, sv: ([used, left]) => `${used} % av utrymmet använt · ${left} % återstår`,
    de: ([used, left]) => `${used} % des Spielraums genutzt · ${left} % verbleibend`, ru: ([used, left]) => `Использовано ${used} % лимита · осталось ${left} %`,
    fr: ([used, left]) => `${used} % de la marge utilisée · ${left} % restants`,
  }),
  template(/^(\d+)% toward personal goal · (\d+)% remaining$/, {
    ar: ([done, left]) => `${done}٪ نحو الهدف الشخصي · متبقٍ ${left}٪`, es: ([done, left]) => `${done} % hacia el objetivo personal · ${left} % restante`,
    "zh-Hans": ([done, left]) => `个人目标已完成 ${done}% · 剩余 ${left}%`, sv: ([done, left]) => `${done} % mot personligt mål · ${left} % återstår`,
    de: ([done, left]) => `${done} % des persönlichen Ziels · ${left} % verbleibend`, ru: ([done, left]) => `${done} % личной цели · осталось ${left} %`,
    fr: ([done, left]) => `${done} % vers l’objectif personnel · ${left} % restants`,
  }),
  template(/^(\d+(?:[.,]\d+)?) days in a row$/, {
    ar: ([value]) => `${value} أيام متتالية`, es: ([value]) => `${value} días seguidos`, "zh-Hans": ([value]) => `连续 ${value} 天`,
    sv: ([value]) => `${value} dagar i rad`, de: ([value]) => `${value} Tage in Folge`, ru: ([value]) => `${value} дн. подряд`, fr: ([value]) => `${value} jours de suite`,
  }),
  template(/^(\d+) earned$/, {
    ar: ([value]) => `تم كسبها ${value} مرة`, es: ([value]) => `${value} conseguidos`, "zh-Hans": ([value]) => `已获得 ${value} 次`,
    sv: ([value]) => `${value} intjänade`, de: ([value]) => `${value} erreicht`, ru: ([value]) => `Получено: ${value}`, fr: ([value]) => `${value} obtenus`,
  }),
  template(/^(\d+) perfect days?$/, {
    ar: ([value]) => `${value} من الأيام المثالية`, es: ([value]) => `${value} días perfectos`, "zh-Hans": ([value]) => `${value} 个完美日`,
    sv: ([value]) => `${value} perfekta dagar`, de: ([value]) => `${value} perfekte Tage`, ru: ([value]) => `${value} идеальных дн.`, fr: ([value]) => `${value} jours parfaits`,
  }),
  template(/^(\d+) active days?$/, {
    ar: ([value]) => `${value} من الأيام النشطة`, es: ([value]) => `${value} días activos`, "zh-Hans": ([value]) => `${value} 个活跃日`,
    sv: ([value]) => `${value} aktiva dagar`, de: ([value]) => `${value} aktive Tage`, ru: ([value]) => `${value} активных дн.`, fr: ([value]) => `${value} jours actifs`,
  }),
  template(/^(\d+) current · (\d+) best$/, {
    ar: ([current, best]) => `الحالي ${current} · الأفضل ${best}`, es: ([current, best]) => `actual ${current} · mejor ${best}`,
    "zh-Hans": ([current, best]) => `当前 ${current} · 最佳 ${best}`, sv: ([current, best]) => `nuvarande ${current} · bäst ${best}`,
    de: ([current, best]) => `aktuell ${current} · Bestwert ${best}`, ru: ([current, best]) => `текущая ${current} · лучшая ${best}`,
    fr: ([current, best]) => `actuelle ${current} · meilleure ${best}`,
  }),
  template(/^(\d+)-completion milestone$/, {
    ar: ([value]) => `إنجاز الإكمال ${value}`, es: ([value]) => `Hito de ${value} logros`, "zh-Hans": ([value]) => `${value} 次完成里程碑`,
    sv: ([value]) => `${value}-milstolpe`, de: ([value]) => `${value}-Abschlussmeilenstein`, ru: ([value]) => `Рубеж: ${value} выполнений`, fr: ([value]) => `Palier de ${value} réussites`,
  }),
  template(/^(\d+) point surge$/, {
    ar: ([value]) => `قفزة بمقدار ${value} نقطة`, es: ([value]) => `Subida de ${value} puntos`, "zh-Hans": ([value]) => `提升 ${value} 分`,
    sv: ([value]) => `ökning med ${value} poäng`, de: ([value]) => `Anstieg um ${value} Punkte`, ru: ([value]) => `Рост на ${value} баллов`, fr: ([value]) => `Hausse de ${value} points`,
  }),
  template(/^(\d+)\/7 all-goal days$/, {
    ar: ([value]) => `${value}/7 أيام اكتملت فيها كل الأهداف`, es: ([value]) => `${value}/7 días con todos los objetivos`, "zh-Hans": ([value]) => `${value}/7 个全目标达成日`,
    sv: ([value]) => `${value}/7 dagar med alla mål`, de: ([value]) => `${value}/7 Tage mit allen Zielen`, ru: ([value]) => `${value}/7 дней со всеми целями`, fr: ([value]) => `${value}/7 jours avec tous les objectifs`,
  }),
  template(/^(\d+)\/7 logged days at ≤50g carbs$/, {
    ar: ([value]) => `${value}/7 أيام مسجلة عند ≤50 غ كربوهيدرات`, es: ([value]) => `${value}/7 días registrados con ≤50 g de carbohidratos`, "zh-Hans": ([value]) => `${value}/7 天记录的碳水不超过 50 克`,
    sv: ([value]) => `${value}/7 loggade dagar med ≤50 g kolhydrater`, de: ([value]) => `${value}/7 protokollierte Tage mit ≤50 g Kohlenhydraten`, ru: ([value]) => `${value}/7 записанных дней с ≤50 г углеводов`, fr: ([value]) => `${value}/7 jours enregistrés à ≤50 g de glucides`,
  }),
  template(/^(\d+(?:[.,]\d+)?) steps\/day$/, {
    ar: ([value]) => `${value} خطوة/يوم`, es: ([value]) => `${value} pasos/día`, "zh-Hans": ([value]) => `${value} 步/天`,
    sv: ([value]) => `${value} steg/dag`, de: ([value]) => `${value} Schritte/Tag`, ru: ([value]) => `${value} шагов/день`, fr: ([value]) => `${value} pas/jour`,
  }),
  template(/^(\d+(?:[.,]\d+)?) estimated kilometres this week\.$/, {
    ar: ([value]) => `نحو ${value} كم تقديريًا هذا الأسبوع.`, es: ([value]) => `${value} km estimados esta semana.`, "zh-Hans": ([value]) => `本周估算约 ${value} 公里。`,
    sv: ([value]) => `Uppskattningsvis ${value} km den här veckan.`, de: ([value]) => `Geschätzte ${value} km in dieser Woche.`, ru: ([value]) => `Около ${value} км за эту неделю.`, fr: ([value]) => `Environ ${value} km estimés cette semaine.`,
  }),
  template(/^(\d+(?:[.,]\d+)?) marathons$/, {
    ar: ([value]) => `${value} ماراثون`, es: ([value]) => `${value} maratones`, "zh-Hans": ([value]) => `${value} 个马拉松`,
    sv: ([value]) => `${value} maraton`, de: ([value]) => `${value} Marathons`, ru: ([value]) => `${value} марафона`, fr: ([value]) => `${value} marathons`,
  }),
  template(/^Your ([\d.,]+) steps add up to roughly ([\d.,]+) km\.$/, {
    ar: ([steps, km]) => `تساوي خطواتك البالغة ${steps} نحو ${km} كم.`, es: ([steps, km]) => `Tus ${steps} pasos suman aproximadamente ${km} km.`, "zh-Hans": ([steps, km]) => `你的 ${steps} 步约合 ${km} 公里。`,
    sv: ([steps, km]) => `Dina ${steps} steg motsvarar ungefär ${km} km.`, de: ([steps, km]) => `Deine ${steps} Schritte ergeben ungefähr ${km} km.`, ru: ([steps, km]) => `Ваши ${steps} шагов — это примерно ${km} км.`, fr: ([steps, km]) => `Vos ${steps} pas représentent environ ${km} km.`,
  }),
  template(/^(\d+)% goal rate$/, {
    ar: ([value]) => `معدل تحقيق الهدف ${value}٪`, es: ([value]) => `${value} % de objetivos cumplidos`, "zh-Hans": ([value]) => `目标达成率 ${value}%`,
    sv: ([value]) => `${value} % måluppfyllelse`, de: ([value]) => `${value} % Zielquote`, ru: ([value]) => `${value} % достижения целей`, fr: ([value]) => `${value} % de réussite des objectifs`,
  }),
  template(/^(.+?) leads the week$/, {
    ar: ([name]) => `${name} يتصدر الأسبوع`, es: ([name]) => `${name} lidera la semana`, "zh-Hans": ([name]) => `${name} 本周领先`,
    sv: ([name]) => `${name} leder veckan`, de: ([name]) => `${name} führt diese Woche`, ru: ([name]) => `${name} лидирует на этой неделе`, fr: ([name]) => `${name} mène cette semaine`,
  }),
  template(/^(.+?) LEADER$/, {
    ar: ([name]) => `متصدر ${localizeCaptured("ar", name)}`, es: ([name]) => `LÍDER DE ${localizeCaptured("es", name)}`, "zh-Hans": ([name]) => `${localizeCaptured("zh-Hans", name)}领先者`,
    sv: ([name]) => `${localizeCaptured("sv", name)}-LEDARE`, de: ([name]) => `${localizeCaptured("de", name)}-FÜHRUNG`, ru: ([name]) => `ЛИДЕР: ${localizeCaptured("ru", name)}`, fr: ([name]) => `LEADER ${localizeCaptured("fr", name)}`,
  }),
  template(/^(\d+) friends$/, {
    ar: ([value]) => `${value} أصدقاء`, es: ([value]) => `${value} amigos`, "zh-Hans": ([value]) => `${value} 位好友`,
    sv: ([value]) => `${value} vänner`, de: ([value]) => `${value} Freunde`, ru: ([value]) => `${value} друзей`, fr: ([value]) => `${value} amis`,
  }),
  template(/^(Breakfast|Lunch|Dinner|Snack) logged\. (\d+) kcal remain for today\.$/, {
    ar: ([meal, value]) => `تم تسجيل ${direct("ar", meal)}. تبقّى ${value} سعرة حرارية لليوم.`, es: ([meal, value]) => `${direct("es", meal)} registrado. Quedan ${value} kcal para hoy.`,
    "zh-Hans": ([meal, value]) => `已记录${direct("zh-Hans", meal)}。今天还剩 ${value} 千卡。`, sv: ([meal, value]) => `${direct("sv", meal)} loggad. ${value} kcal återstår idag.`,
    de: ([meal, value]) => `${direct("de", meal)} protokolliert. Heute verbleiben ${value} kcal.`, ru: ([meal, value]) => `${direct("ru", meal)} записан. На сегодня осталось ${value} ккал.`,
    fr: ([meal, value]) => `${direct("fr", meal)} enregistré. Il reste ${value} kcal aujourd’hui.`,
  }),
  template(/^(\d+) kcal remain for today\.$/, {
    ar: ([value]) => `تبقّى ${value} سعرة حرارية لليوم.`, es: ([value]) => `Quedan ${value} kcal para hoy.`, "zh-Hans": ([value]) => `今天还剩 ${value} 千卡。`,
    sv: ([value]) => `${value} kcal återstår idag.`, de: ([value]) => `Heute verbleiben ${value} kcal.`, ru: ([value]) => `На сегодня осталось ${value} ккал.`, fr: ([value]) => `Il reste ${value} kcal aujourd’hui.`,
  }),
  template(/^You are (\d+) kcal over today’s current food allowance\. Activity can still improve the daily balance\.$/, {
    ar: ([value]) => `لقد تجاوزت حد الطعام الحالي اليوم بمقدار ${value} سعرة حرارية. لا يزال بإمكان النشاط تحسين توازن اليوم.`,
    es: ([value]) => `Has superado en ${value} kcal el límite actual de hoy. La actividad aún puede mejorar el balance diario.`,
    "zh-Hans": ([value]) => `你已超出今天当前饮食额度 ${value} 千卡；活动仍可改善今日能量平衡。`,
    sv: ([value]) => `Du ligger ${value} kcal över dagens aktuella matutrymme. Aktivitet kan fortfarande förbättra dagens balans.`,
    de: ([value]) => `Du liegst ${value} kcal über dem heutigen Ernährungsspielraum. Aktivität kann die Tagesbilanz noch verbessern.`,
    ru: ([value]) => `Вы превысили сегодняшний лимит питания на ${value} ккал. Активность ещё может улучшить дневной баланс.`,
    fr: ([value]) => `Vous dépassez de ${value} kcal la marge alimentaire actuelle. L’activité peut encore améliorer le bilan du jour.`,
  }),
  template(/^About (\d+) active kcal—or roughly (\d+) minutes of walking—would close today’s energy gap\.$/, {
    ar: ([kcal, min]) => `نحو ${kcal} سعرة حرارية نشطة، أو قرابة ${min} دقيقة مشي، ستغلق فجوة الطاقة اليوم.`, es: ([kcal, min]) => `Unas ${kcal} kcal activas, o aproximadamente ${min} minutos caminando, cerrarían la diferencia energética de hoy.`,
    "zh-Hans": ([kcal, min]) => `约 ${kcal} 活动千卡（约步行 ${min} 分钟）可弥补今天的能量差。`, sv: ([kcal, min]) => `Cirka ${kcal} aktiva kcal, eller ungefär ${min} minuters promenad, skulle täcka dagens energigap.`,
    de: ([kcal, min]) => `Etwa ${kcal} aktive kcal – ungefähr ${min} Minuten Gehen – würden die heutige Energielücke schließen.`, ru: ([kcal, min]) => `Около ${kcal} активных ккал — примерно ${min} минут ходьбы — закроют сегодняшний энергетический разрыв.`,
    fr: ([kcal, min]) => `Environ ${kcal} kcal actives, soit près de ${min} minutes de marche, combleraient l’écart énergétique du jour.`,
  }),
  template(/^You have (\d+) (.+) left for this goal\.$/, {
    ar: ([value, unit]) => `تبقّى ${value} ${unit} لهذا الهدف.`, es: ([value, unit]) => `Te quedan ${value} ${unit} para este objetivo.`, "zh-Hans": ([value, unit]) => `此目标还差 ${value} ${unit}。`,
    sv: ([value, unit]) => `${value} ${unit} återstår för målet.`, de: ([value, unit]) => `Für dieses Ziel fehlen noch ${value} ${unit}.`, ru: ([value, unit]) => `До этой цели осталось ${value} ${unit}.`, fr: ([value, unit]) => `Il vous reste ${value} ${unit} pour cet objectif.`,
  }),
  template(/^(\d+(?:[.,]\d+)?) more hours would reach your sleep range\.$/, {
    ar: ([value]) => `${value} ساعة إضافية ستوصلك إلى نطاق نومك.`, es: ([value]) => `${value} horas más te permitirían alcanzar tu intervalo de sueño.`, "zh-Hans": ([value]) => `再睡 ${value} 小时即可达到睡眠范围。`,
    sv: ([value]) => `${value} timmar till skulle nå ditt sömnintervall.`, de: ([value]) => `Mit ${value} weiteren Stunden würdest du deinen Schlafbereich erreichen.`, ru: ([value]) => `Ещё ${value} ч сна позволят достичь выбранного диапазона.`, fr: ([value]) => `${value} heures de plus permettraient d’atteindre votre plage de sommeil.`,
  }),
  template(/^(.+?) is (\d+(?:[.,]\d+)?) (.+) (below|above) your range\.$/, {
    ar: ([name, value, unit, direction]) => `${localizeCaptured("ar", name)} ${direction === "below" ? "أقل" : "أعلى"} من نطاقك بمقدار ${localizeCaptured("ar", `${value} ${unit}`)}.`, es: ([name, value, unit, direction]) => `${localizeCaptured("es", name)} está ${localizeCaptured("es", `${value} ${unit}`)} ${direction === "below" ? "por debajo" : "por encima"} de tu intervalo.`,
    "zh-Hans": ([name, value, unit, direction]) => `${localizeCaptured("zh-Hans", name)}${direction === "below" ? "低于" : "高于"}范围 ${localizeCaptured("zh-Hans", `${value} ${unit}`)}。`, sv: ([name, value, unit, direction]) => `${localizeCaptured("sv", name)} ligger ${localizeCaptured("sv", `${value} ${unit}`)} ${direction === "below" ? "under" : "över"} ditt intervall.`,
    de: ([name, value, unit, direction]) => `${localizeCaptured("de", name)} liegt ${localizeCaptured("de", `${value} ${unit}`)} ${direction === "below" ? "unter" : "über"} deinem Bereich.`, ru: ([name, value, unit, direction]) => `${localizeCaptured("ru", name)}: на ${localizeCaptured("ru", `${value} ${unit}`)} ${direction === "below" ? "ниже" : "выше"} диапазона.`,
    fr: ([name, value, unit, direction]) => `${localizeCaptured("fr", name)} est de ${localizeCaptured("fr", `${value} ${unit}`)} ${direction === "below" ? "sous" : "au-dessus de"} votre plage.`,
  }),
  template(/^(.+?) is inside your selected range\.$/, {
    ar: ([name]) => `${localizeCaptured("ar", name)} ضمن النطاق الذي حددته.`, es: ([name]) => `${localizeCaptured("es", name)} está dentro del intervalo seleccionado.`, "zh-Hans": ([name]) => `${localizeCaptured("zh-Hans", name)}在你选择的范围内。`,
    sv: ([name]) => `${localizeCaptured("sv", name)} ligger inom ditt valda intervall.`, de: ([name]) => `${localizeCaptured("de", name)} liegt im gewählten Bereich.`, ru: ([name]) => `${localizeCaptured("ru", name)} находится в выбранном диапазоне.`, fr: ([name]) => `${localizeCaptured("fr", name)} se situe dans la plage choisie.`,
  }),
  template(/^It has been (\d+) days since (.+?)\. Reuse it or choose another saved workout when you are ready\.$/, {
    ar: ([days, name]) => `مرّ ${days} يومًا منذ ${name}. أعد استخدامه أو اختر تمرينًا محفوظًا آخر عندما تكون جاهزًا.`, es: ([days, name]) => `Han pasado ${days} días desde ${name}. Reutilízalo o elige otro entrenamiento guardado cuando quieras.`,
    "zh-Hans": ([days, name]) => `距 ${name} 已有 ${days} 天。准备好后可再次使用或选择其他已保存锻炼。`, sv: ([days, name]) => `Det har gått ${days} dagar sedan ${name}. Återanvänd passet eller välj ett annat sparat pass när du är redo.`,
    de: ([days, name]) => `Seit ${name} sind ${days} Tage vergangen. Verwende es erneut oder wähle ein anderes gespeichertes Training.`, ru: ([days, name]) => `После «${name}» прошло ${days} дн. Повторите тренировку или выберите другую сохранённую.`,
    fr: ([days, name]) => `${days} jours se sont écoulés depuis ${name}. Réutilisez cette séance ou choisissez-en une autre quand vous le souhaitez.`,
  }),
  template(/^Longest current streak for the (.+?) goal\. This award adapts automatically when the goal changes\.$/, {
    ar: ([name]) => `أطول سلسلة حالية لهدف ${localizeCaptured("ar", name)}. تتكيف هذه الشارة تلقائيًا عند تغير الهدف.`, es: ([name]) => `La racha actual más larga del objetivo ${localizeCaptured("es", name)}. Esta insignia se adapta cuando cambia el objetivo.`,
    "zh-Hans": ([name]) => `${localizeCaptured("zh-Hans", name)}目标的最长当前连续记录。目标变化时，此徽章会自动调整。`, sv: ([name]) => `Längsta aktuella svit för målet ${localizeCaptured("sv", name)}. Märket anpassas automatiskt när målet ändras.`,
    de: ([name]) => `Längste aktuelle Serie für das Ziel ${localizeCaptured("de", name)}. Das Abzeichen passt sich bei Zieländerungen automatisch an.`, ru: ([name]) => `Самая длинная текущая серия для цели «${localizeCaptured("ru", name)}». Награда автоматически учитывает изменение цели.`,
    fr: ([name]) => `Plus longue série actuelle pour l’objectif ${localizeCaptured("fr", name)}. Ce badge s’adapte automatiquement lorsque l’objectif change.`,
  }),
  template(/^(.+?) · (Selected day|Previous day|This week|Month|Year)$/, {
    ar: ([name, period]) => `${localizeCaptured("ar", name)} · ${localizeCaptured("ar", period)}`,
    es: ([name, period]) => `${localizeCaptured("es", name)} · ${localizeCaptured("es", period)}`,
    "zh-Hans": ([name, period]) => `${localizeCaptured("zh-Hans", name)} · ${localizeCaptured("zh-Hans", period)}`,
    sv: ([name, period]) => `${localizeCaptured("sv", name)} · ${localizeCaptured("sv", period)}`,
    de: ([name, period]) => `${localizeCaptured("de", name)} · ${localizeCaptured("de", period)}`,
    ru: ([name, period]) => `${localizeCaptured("ru", name)} · ${localizeCaptured("ru", period)}`,
    fr: ([name, period]) => `${localizeCaptured("fr", name)} · ${localizeCaptured("fr", period)}`,
  }),
  template(/^Best shared (.+?) result for (selected day|previous day|this week|month|year)\.$/, {
    ar: ([name, period]) => `أفضل نتيجة مشتركة ${arabicFor(name)} خلال ${localizeCaptured("ar", period)}.`,
    es: ([name, period]) => `Mejor resultado compartido de ${localizeCaptured("es", name)} en ${localizeCaptured("es", period)}.`,
    "zh-Hans": ([name, period]) => `${localizeCaptured("zh-Hans", period)}的最佳共享${localizeCaptured("zh-Hans", name)}结果。`,
    sv: ([name, period]) => `Bästa delade resultat för ${localizeCaptured("sv", name)} under ${localizeCaptured("sv", period)}.`,
    de: ([name, period]) => `Bestes geteiltes Ergebnis für ${localizeCaptured("de", name)} im Zeitraum ${localizeCaptured("de", period)}.`,
    ru: ([name, period]) => `Лучший общий результат «${localizeCaptured("ru", name)}» за период «${localizeCaptured("ru", period)}».`,
    fr: ([name, period]) => `Meilleur résultat partagé pour ${localizeCaptured("fr", name)} sur la période ${localizeCaptured("fr", period)}.`,
  }),
  template(/^Complete this goal (\d+) more times? to reach the (\d+)-completion milestone\.$/, {
    ar: ([left, target]) => `أكمل هذا الهدف ${left} مرة أخرى للوصول إلى إنجاز ${target} إكمالًا.`, es: ([left, target]) => `Completa este objetivo ${left} veces más para alcanzar el hito de ${target} logros.`,
    "zh-Hans": ([left, target]) => `再完成此目标 ${left} 次，即可达到 ${target} 次完成里程碑。`, sv: ([left, target]) => `Slutför målet ${left} gånger till för att nå milstolpen ${target}.`,
    de: ([left, target]) => `Erreiche dieses Ziel noch ${left}-mal, um den Meilenstein von ${target} Abschlüssen zu erreichen.`, ru: ([left, target]) => `Выполните эту цель ещё ${left} раз, чтобы достичь рубежа ${target}.`,
    fr: ([left, target]) => `Atteignez encore cet objectif ${left} fois pour atteindre le palier de ${target} réussites.`,
  }),
  template(/^(\d+) more perfect days? until the (\d+)-day milestone\.$/, {
    ar: ([left, target]) => `تبقّى ${left} من الأيام المثالية للوصول إلى إنجاز ${target} يومًا.`, es: ([left, target]) => `Faltan ${left} días perfectos para alcanzar el hito de ${target} días.`,
    "zh-Hans": ([left, target]) => `再有 ${left} 个完美日即可达到 ${target} 天里程碑。`, sv: ([left, target]) => `${left} perfekta dagar återstår till milstolpen ${target} dagar.`,
    de: ([left, target]) => `Noch ${left} perfekte Tage bis zum ${target}-Tage-Meilenstein.`, ru: ([left, target]) => `Ещё ${left} идеальных дн. до рубежа ${target} дней.`,
    fr: ([left, target]) => `Encore ${left} jours parfaits avant le palier de ${target} jours.`,
  }),
  template(/^Log a group tracker on (\d+) more days? to reach the (\d+)-day milestone\.$/, {
    ar: ([left, target]) => `سجّل مؤشرًا جماعيًا في ${left} يوم إضافي للوصول إلى إنجاز ${target} يومًا.`,
    es: ([left, target]) => `Registra un indicador del grupo durante ${left} días más para alcanzar el hito de ${target} días.`,
    "zh-Hans": ([left, target]) => `再有 ${left} 天记录群组追踪项，即可达到 ${target} 天里程碑。`,
    sv: ([left, target]) => `Logga en gruppspårare under ytterligare ${left} dagar för att nå milstolpen ${target} dagar.`,
    de: ([left, target]) => `Protokolliere an ${left} weiteren Tagen einen Gruppen-Tracker, um den ${target}-Tage-Meilenstein zu erreichen.`,
    ru: ([left, target]) => `Записывайте групповой показатель ещё ${left} дн., чтобы достичь рубежа ${target} дней.`,
    fr: ([left, target]) => `Enregistrez un suivi de groupe pendant encore ${left} jours pour atteindre le palier de ${target} jours.`,
  }),
  template(/^Highest shared daily (.+?) result, set (\d{4}-\d{2}-\d{2})\.$/, {
    ar: ([name, date]) => `أعلى نتيجة يومية مشتركة ${arabicFor(name)}، سُجلت في ${date}.`, es: ([name, date]) => `Mejor resultado diario compartido de ${localizeCaptured("es", name)}, logrado el ${date}.`,
    "zh-Hans": ([name, date]) => `${localizeCaptured("zh-Hans", name)}的最高共享日结果，创于 ${date}。`, sv: ([name, date]) => `Högsta delade dagsresultat för ${localizeCaptured("sv", name)}, satt ${date}.`,
    de: ([name, date]) => `Höchster geteilter Tageswert für ${localizeCaptured("de", name)}, erreicht am ${date}.`, ru: ([name, date]) => `Лучший общий дневной результат «${localizeCaptured("ru", name)}», установлен ${date}.`,
    fr: ([name, date]) => `Meilleur résultat quotidien partagé pour ${localizeCaptured("fr", name)}, établi le ${date}.`,
  }),
  template(/^(\d+) more best-streak days? to reach the (\d+)-day award\.$/, {
    ar: ([left, target]) => `تبقّى ${left} يومًا لتحسين أفضل سلسلة والوصول إلى جائزة ${target} يومًا.`,
    es: ([left, target]) => `Faltan ${left} días de mejor racha para alcanzar el premio de ${target} días.`,
    "zh-Hans": ([left, target]) => `最佳连续记录再增加 ${left} 天，即可获得 ${target} 天奖励。`,
    sv: ([left, target]) => `${left} dagar återstår för att förbättra bästa sviten till ${target}-dagarsmärket.`,
    de: ([left, target]) => `Noch ${left} Bestserien-Tage bis zur ${target}-Tage-Auszeichnung.`,
    ru: ([left, target]) => `Ещё ${left} дн. к лучшей серии до награды за ${target} дней.`,
    fr: ([left, target]) => `Encore ${left} jours de meilleure série avant la récompense de ${target} jours.`,
  }),
  template(/^Highest streak tier reached at (\d+) days\.$/, {
    ar: ([days]) => `تم بلوغ أعلى مستوى للسلسلة عند ${days} يومًا.`,
    es: ([days]) => `Se alcanzó el nivel de racha más alto con ${days} días.`,
    "zh-Hans": ([days]) => `已达到最高连续等级：${days} 天。`,
    sv: ([days]) => `Högsta svitnivån nåddes vid ${days} dagar.`,
    de: ([days]) => `Höchste Serienstufe mit ${days} Tagen erreicht.`,
    ru: ([days]) => `Достигнут высший уровень серии: ${days} дн.`,
    fr: ([days]) => `Niveau de série maximal atteint à ${days} jours.`,
  }),
  template(/^Earned by reaching the (\d+) milestone\. Keep going to unlock the next tier\.$/, {
    ar: ([target]) => `اكتُسبت ببلوغ إنجاز ${target}. واصل التقدم لفتح المستوى التالي.`,
    es: ([target]) => `Conseguido al alcanzar el hito ${target}. Sigue para desbloquear el siguiente nivel.`,
    "zh-Hans": ([target]) => `达到 ${target} 次里程碑后获得。继续前进以解锁下一等级。`,
    sv: ([target]) => `Intjänat genom att nå milstolpen ${target}. Fortsätt för att låsa upp nästa nivå.`,
    de: ([target]) => `Durch Erreichen des Meilensteins ${target} verdient. Weiter so für die nächste Stufe.`,
    ru: ([target]) => `Получено за достижение рубежа ${target}. Продолжайте, чтобы открыть следующий уровень.`,
    fr: ([target]) => `Obtenu en atteignant le palier ${target}. Continuez pour débloquer le niveau suivant.`,
  }),
  template(/^(\d+)\/7 perfect days$/, {
    ar: ([value]) => `${value}/7 أيام مثالية`, es: ([value]) => `${value}/7 días perfectos`,
    "zh-Hans": ([value]) => `${value}/7 个完美日`, sv: ([value]) => `${value}/7 perfekta dagar`,
    de: ([value]) => `${value}/7 perfekte Tage`, ru: ([value]) => `${value}/7 идеальных дней`, fr: ([value]) => `${value}/7 jours parfaits`,
  }),
  template(/^Most all-goal days this week\. Up to (\d+) rest days? may preserve streaks\.$/, {
    ar: ([days]) => `أكبر عدد من الأيام المكتملة الأهداف هذا الأسبوع. قد تحافظ حتى ${days} من أيام الراحة على السلاسل.`,
    es: ([days]) => `Mayor número de días con todos los objetivos esta semana. Hasta ${days} días de descanso pueden conservar las rachas.`,
    "zh-Hans": ([days]) => `本周完成全部目标的天数最多。最多 ${days} 个休息日可保留连续记录。`,
    sv: ([days]) => `Flest dagar med alla mål den här veckan. Upp till ${days} vilodagar kan bevara sviter.`,
    de: ([days]) => `Die meisten Tage mit allen Zielen in dieser Woche. Bis zu ${days} Ruhetage können Serien erhalten.`,
    ru: ([days]) => `Больше всего дней со всеми целями на этой неделе. До ${days} дней отдыха могут сохранить серии.`,
    fr: ([days]) => `Plus grand nombre de journées avec tous les objectifs cette semaine. Jusqu’à ${days} jours de repos peuvent préserver les séries.`,
  }),
  template(/^(\d+)% (more|less) than last week · about ([\d.,]+) km\.$/, {
    ar: ([value, direction, km]) => `${value}٪ ${direction === "more" ? "أكثر" : "أقل"} من الأسبوع الماضي · نحو ${km} كم.`, es: ([value, direction, km]) => `${value} % ${direction === "more" ? "más" : "menos"} que la semana pasada · unos ${km} km.`,
    "zh-Hans": ([value, direction, km]) => `比上周${direction === "more" ? "多" : "少"} ${value}% · 约 ${km} 公里。`, sv: ([value, direction, km]) => `${value} % ${direction === "more" ? "mer" : "mindre"} än förra veckan · cirka ${km} km.`,
    de: ([value, direction, km]) => `${value} % ${direction === "more" ? "mehr" : "weniger"} als letzte Woche · etwa ${km} km.`, ru: ([value, direction, km]) => `На ${value} % ${direction === "more" ? "больше" : "меньше"}, чем на прошлой неделе · около ${km} км.`,
    fr: ([value, direction, km]) => `${value} % de ${direction === "more" ? "plus" : "moins"} que la semaine dernière · environ ${km} km.`,
  }),
  template(/^(.+?) RECAP$/, {
    ar: ([name]) => `ملخص ${name}`, es: ([name]) => `RESUMEN DE ${name}`, "zh-Hans": ([name]) => `${name} 回顾`,
    sv: ([name]) => `${name} · SAMMANFATTNING`, de: ([name]) => `${name} · RÜCKBLICK`, ru: ([name]) => `${name} · ИТОГИ`, fr: ([name]) => `RÉCAPITULATIF ${name}`,
  }),
  template(/^Roughly ([\d.,]+) km combined—about ([\d.,]+) marathons\.$/, {
    ar: ([km, marathons]) => `نحو ${km} كم معًا، أي قرابة ${marathons} ماراثون.`, es: ([km, marathons]) => `Unos ${km} km en conjunto: aproximadamente ${marathons} maratones.`,
    "zh-Hans": ([km, marathons]) => `合计约 ${km} 公里，相当于约 ${marathons} 个马拉松。`, sv: ([km, marathons]) => `Cirka ${km} km tillsammans – ungefär ${marathons} maraton.`,
    de: ([km, marathons]) => `Zusammen rund ${km} km – etwa ${marathons} Marathons.`, ru: ([km, marathons]) => `Вместе около ${km} км — примерно ${marathons} марафона.`,
    fr: ([km, marathons]) => `Environ ${km} km cumulés, soit près de ${marathons} marathons.`,
  }),
  template(/^(.*?) reminder$/, {
    ar: ([name]) => `تذكير ${localizeCaptured("ar", name)}`, es: ([name]) => `Recordatorio de ${localizeCaptured("es", name)}`,
    "zh-Hans": ([name]) => `${localizeCaptured("zh-Hans", name)}提醒`, sv: ([name]) => `${localizeCaptured("sv", name)}-påminnelse`,
    de: ([name]) => `${localizeCaptured("de", name)}-Erinnerung`, ru: ([name]) => `Напоминание: ${localizeCaptured("ru", name)}`, fr: ([name]) => `Rappel : ${localizeCaptured("fr", name)}`,
  }),
  template(/^(.*?) streak$/, {
    ar: ([name]) => `سلسلة ${localizeCaptured("ar", name)}`, es: ([name]) => `Racha de ${localizeCaptured("es", name)}`, "zh-Hans": ([name]) => `${localizeCaptured("zh-Hans", name)}连续达标`,
    sv: ([name]) => `${localizeCaptured("sv", name)}-svit`, de: ([name]) => `${localizeCaptured("de", name)}-Serie`, ru: ([name]) => `Серия: ${localizeCaptured("ru", name)}`, fr: ([name]) => `Série ${localizeCaptured("fr", name)}`,
  }),
  template(/^(.*?) goals$/, {
    ar: ([name]) => `أهداف ${localizeCaptured("ar", name)}`, es: ([name]) => `Objetivos de ${localizeCaptured("es", name)}`, "zh-Hans": ([name]) => `${localizeCaptured("zh-Hans", name)}目标`,
    sv: ([name]) => `${localizeCaptured("sv", name)}-mål`, de: ([name]) => `${localizeCaptured("de", name)}-Ziele`, ru: ([name]) => `Цели: ${localizeCaptured("ru", name)}`, fr: ([name]) => `Objectifs ${localizeCaptured("fr", name)}`,
  }),
  template(/^(.*?) personal best$/, {
    ar: ([name]) => `أفضل رقم شخصي في ${localizeCaptured("ar", name)}`, es: ([name]) => `Mejor marca personal de ${localizeCaptured("es", name)}`, "zh-Hans": ([name]) => `${localizeCaptured("zh-Hans", name)}个人最佳`,
    sv: ([name]) => `Personbästa i ${localizeCaptured("sv", name)}`, de: ([name]) => `Persönlicher Bestwert: ${localizeCaptured("de", name)}`, ru: ([name]) => `Личный рекорд: ${localizeCaptured("ru", name)}`, fr: ([name]) => `Record personnel : ${localizeCaptured("fr", name)}`,
  }),
  template(/^(.+?) · (\d+)$/, {
    ar: ([title, value]) => `${translateDomainText("ar", title)} · ${value}`,
    es: ([title, value]) => `${translateDomainText("es", title)} · ${value}`,
    "zh-Hans": ([title, value]) => `${translateDomainText("zh-Hans", title)} · ${value}`,
    sv: ([title, value]) => `${translateDomainText("sv", title)} · ${value}`,
    de: ([title, value]) => `${translateDomainText("de", title)} · ${value}`,
    ru: ([title, value]) => `${translateDomainText("ru", title)} · ${value}`,
    fr: ([title, value]) => `${translateDomainText("fr", title)} · ${value}`,
  }),
  template(/^Direct message from (.+)$/, {
    ar: ([name]) => `رسالة مباشرة من ${name}`, es: ([name]) => `Mensaje directo de ${name}`, "zh-Hans": ([name]) => `来自 ${name} 的私信`,
    sv: ([name]) => `Direktmeddelande från ${name}`, de: ([name]) => `Direktnachricht von ${name}`, ru: ([name]) => `Личное сообщение от ${name}`, fr: ([name]) => `Message direct de ${name}`,
  }),
  template(/^Group message from (.+)$/, {
    ar: ([name]) => `رسالة مجموعة من ${name}`, es: ([name]) => `Mensaje de grupo de ${name}`, "zh-Hans": ([name]) => `来自 ${name} 的群组消息`,
    sv: ([name]) => `Gruppmeddelande från ${name}`, de: ([name]) => `Gruppennachricht von ${name}`, ru: ([name]) => `Сообщение в группе от ${name}`, fr: ([name]) => `Message de groupe de ${name}`,
  }),
  template(/^(.+?) logged (.+)$/, {
    ar: ([name, metric]) => `سجّل ${name} ${metric}`, es: ([name, metric]) => `${name} registró ${metric}`, "zh-Hans": ([name, metric]) => `${name} 记录了${metric}`,
    sv: ([name, metric]) => `${name} loggade ${metric}`, de: ([name, metric]) => `${name} hat ${metric} protokolliert`, ru: ([name, metric]) => `${name}: записано «${metric}»`, fr: ([name, metric]) => `${name} a enregistré ${metric}`,
  }),
  template(/^(.+?) took the lead$/, {
    ar: ([name]) => `تولى ${name} الصدارة`, es: ([name]) => `${name} tomó el liderato`, "zh-Hans": ([name]) => `${name} 登上榜首`,
    sv: ([name]) => `${name} tog ledningen`, de: ([name]) => `${name} hat die Führung übernommen`, ru: ([name]) => `${name} вышел на первое место`, fr: ([name]) => `${name} prend la tête`,
  }),
  template(/^(.+?) wants to join$/, {
    ar: ([name]) => `${name} يريد الانضمام`, es: ([name]) => `${name} quiere unirse`, "zh-Hans": ([name]) => `${name} 想加入`,
    sv: ([name]) => `${name} vill gå med`, de: ([name]) => `${name} möchte beitreten`, ru: ([name]) => `${name} хочет присоединиться`, fr: ([name]) => `${name} souhaite rejoindre le groupe`,
  }),
  template(/^(.+?) joined$/, {
    ar: ([name]) => `انضم ${name}`, es: ([name]) => `${name} se unió`, "zh-Hans": ([name]) => `${name} 已加入`,
    sv: ([name]) => `${name} gick med`, de: ([name]) => `${name} ist beigetreten`, ru: ([name]) => `${name} присоединился`, fr: ([name]) => `${name} a rejoint le groupe`,
  }),
  template(/^(.+?) left$/, {
    ar: ([name]) => `غادر ${name}`, es: ([name]) => `${name} salió`, "zh-Hans": ([name]) => `${name} 已离开`,
    sv: ([name]) => `${name} lämnade`, de: ([name]) => `${name} hat die Gruppe verlassen`, ru: ([name]) => `${name} вышел из группы`, fr: ([name]) => `${name} a quitté le groupe`,
  }),
  template(/^Welcome to (.+)$/, {
    ar: ([name]) => `مرحبًا بك في ${name}`, es: ([name]) => `Te damos la bienvenida a ${name}`, "zh-Hans": ([name]) => `欢迎加入 ${name}`,
    sv: ([name]) => `Välkommen till ${name}`, de: ([name]) => `Willkommen bei ${name}`, ru: ([name]) => `Добро пожаловать в ${name}`, fr: ([name]) => `Bienvenue dans ${name}`,
  }),
  template(/^Review the request for (.+)\.$/, {
    ar: ([name]) => `راجع طلب الانضمام إلى ${name}.`, es: ([name]) => `Revisa la solicitud para ${name}.`, "zh-Hans": ([name]) => `请审核加入 ${name} 的请求。`,
    sv: ([name]) => `Granska begäran för ${name}.`, de: ([name]) => `Prüfe die Anfrage für ${name}.`, ru: ([name]) => `Рассмотрите запрос для ${name}.`, fr: ([name]) => `Examinez la demande pour ${name}.`,
  }),
  template(/^(.+?) is now in (.+)\.$/, {
    ar: ([person, group]) => `أصبح ${person} الآن في ${group}.`, es: ([person, group]) => `${person} ya está en ${group}.`, "zh-Hans": ([person, group]) => `${person} 现已加入 ${group}。`,
    sv: ([person, group]) => `${person} är nu med i ${group}.`, de: ([person, group]) => `${person} ist jetzt in ${group}.`, ru: ([person, group]) => `${person} теперь в группе ${group}.`, fr: ([person, group]) => `${person} fait maintenant partie de ${group}.`,
  }),
  template(/^(.+?) left (.+)\.$/, {
    ar: ([person, group]) => `غادر ${person} ${group}.`, es: ([person, group]) => `${person} salió de ${group}.`, "zh-Hans": ([person, group]) => `${person} 已离开 ${group}。`,
    sv: ([person, group]) => `${person} lämnade ${group}.`, de: ([person, group]) => `${person} hat ${group} verlassen.`, ru: ([person, group]) => `${person} вышел из группы ${group}.`, fr: ([person, group]) => `${person} a quitté ${group}.`,
  }),
  template(/^You were removed from (.+)\.$/, {
    ar: ([group]) => `تمت إزالتك من ${group}.`, es: ([group]) => `Fuiste eliminado de ${group}.`, "zh-Hans": ([group]) => `你已被移出 ${group}。`,
    sv: ([group]) => `Du togs bort från ${group}.`, de: ([group]) => `Du wurdest aus ${group} entfernt.`, ru: ([group]) => `Вас удалили из группы ${group}.`, fr: ([group]) => `Vous avez été retiré de ${group}.`,
  }),
  template(/^Your next period is estimated in (\d+) days\. This may change as HabHub learns your cycle\.$/, {
    ar: ([days]) => `يُتوقع أن تبدأ دورتك التالية خلال ${days} يومًا. قد يتغير ذلك بينما يتعلم HabHub نمط دورتك.`, es: ([days]) => `Se estima que tu próximo periodo empezará en ${days} días. Puede cambiar a medida que HabHub conozca tu ciclo.`, "zh-Hans": ([days]) => `预计你的下次经期将在 ${days} 天后开始。随着 HabHub 了解你的周期，预测可能会变化。`,
    sv: ([days]) => `Din nästa mens beräknas börja om ${days} dagar. Det kan ändras när HabHub lär sig din cykel.`, de: ([days]) => `Deine nächste Periode wird in ${days} Tagen erwartet. Die Schätzung kann sich ändern, während HabHub deinen Zyklus kennenlernt.`, ru: ([days]) => `Следующая менструация ожидается через ${days} дн. Прогноз может измениться, когда HabHub лучше изучит ваш цикл.`, fr: ([days]) => `Vos prochaines règles sont estimées dans ${days} jours. Cette estimation peut évoluer à mesure que HabHub apprend votre cycle.`,
  }),
  template(/^(\d+(?:[.,]\d+)?) steps remain\. A short walk can move today forward\.$/, {
    ar: ([value]) => `تبقّى ${value} خطوة. يمكن لمشية قصيرة أن تدفع يومك للأمام.`, es: ([value]) => `Quedan ${value} pasos. Un paseo corto puede hacer avanzar el día.`, "zh-Hans": ([value]) => `还差 ${value} 步。短途步行也能推进今天的目标。`,
    sv: ([value]) => `${value} steg återstår. En kort promenad kan föra dagen framåt.`, de: ([value]) => `Noch ${value} Schritte. Ein kurzer Spaziergang bringt dich heute weiter.`, ru: ([value]) => `Осталось ${value} шагов. Короткая прогулка приблизит цель.`, fr: ([value]) => `Il reste ${value} pas. Une courte marche peut faire avancer la journée.`,
  }),
  template(/^(\d+(?:[.,]\d+)?) (.+) remain to reach today’s (.+) goal\.$/, {
    ar: ([value, unit, name]) => `تبقّى ${value} ${unit} للوصول إلى هدف ${name} اليوم.`, es: ([value, unit, name]) => `Faltan ${value} ${unit} para alcanzar el objetivo de ${name} de hoy.`, "zh-Hans": ([value, unit, name]) => `距离今天的${name}目标还差 ${value} ${unit}。`,
    sv: ([value, unit, name]) => `${value} ${unit} återstår till dagens ${name}-mål.`, de: ([value, unit, name]) => `Noch ${value} ${unit} bis zum heutigen ${name}-Ziel.`, ru: ([value, unit, name]) => `До сегодняшней цели «${name}» осталось ${value} ${unit}.`, fr: ([value, unit, name]) => `Il reste ${value} ${unit} pour atteindre l’objectif ${name} du jour.`,
  }),
  template(/^(\d+) of (\d+) individual tracked goals completed across the week\.$/, {
    ar: ([a, b]) => `اكتمل ${a} من أصل ${b} هدفًا متتبعًا خلال الأسبوع.`, es: ([a, b]) => `Se completaron ${a} de ${b} objetivos seguidos durante la semana.`, "zh-Hans": ([a, b]) => `本周共完成 ${a}/${b} 个追踪目标。`,
    sv: ([a, b]) => `${a} av ${b} spårade mål slutfördes under veckan.`, de: ([a, b]) => `${a} von ${b} verfolgten Zielen wurden diese Woche erreicht.`, ru: ([a, b]) => `За неделю выполнено ${a} из ${b} отслеживаемых целей.`, fr: ([a, b]) => `${a} objectifs suivis sur ${b} ont été réalisés cette semaine.`,
  }),
  template(/^(.+?) allocated sets across (.+?) sessions in the selected history\.$/, {
    ar: ([sets, sessions]) => `${sets} مجموعة موزعة على ${sessions} جلسة في السجل المحدد.`,
    es: ([sets, sessions]) => `${sets} series distribuidas en ${sessions} sesiones del historial seleccionado.`,
    "zh-Hans": ([sets, sessions]) => `所选历史中有 ${sets} 组，分布在 ${sessions} 次训练中。`,
    sv: ([sets, sessions]) => `${sets} fördelade set under ${sessions} pass i den valda historiken.`,
    de: ([sets, sessions]) => `${sets} zugeordnete Sätze in ${sessions} Einheiten im ausgewählten Verlauf.`,
    ru: ([sets, sessions]) => `${sets} распределённых подходов в ${sessions} сессиях выбранной истории.`,
    fr: ([sets, sessions]) => `${sets} séries réparties sur ${sessions} séances dans l’historique sélectionné.`,
  }),
  template(/^(.+?) is moving$/, {
    ar: ([name]) => `${localizeCaptured("ar", name)} يتقدم`,
    es: ([name]) => `${localizeCaptured("es", name)} progresa`,
    "zh-Hans": ([name]) => `${localizeCaptured("zh-Hans", name)}正在进步`,
    sv: ([name]) => `${localizeCaptured("sv", name)} utvecklas`,
    de: ([name]) => `${localizeCaptured("de", name)} macht Fortschritte`,
    ru: ([name]) => `${localizeCaptured("ru", name)} прогрессирует`,
    fr: ([name]) => `${localizeCaptured("fr", name)} progresse`,
  }),
  template(/^(.+?) kg of completed-set volume logged\.$/, {
    ar: ([value]) => `تم تسجيل ${value} كغ من حجم المجموعات المكتملة.`,
    es: ([value]) => `Se registraron ${value} kg de volumen en series completadas.`,
    "zh-Hans": ([value]) => `已记录 ${value} 千克的完成组训练容量。`,
    sv: ([value]) => `${value} kg volym från slutförda set har loggats.`,
    de: ([value]) => `${value} kg Volumen aus abgeschlossenen Sätzen protokolliert.`,
    ru: ([value]) => `Записано ${value} кг объёма выполненных подходов.`,
    fr: ([value]) => `${value} kg de volume de séries effectuées enregistrés.`,
  }),
  template(/^(.+?) kg volume versus (.+?) kg in the prior seven days \(([+-]?)(.+?)%\)\.$/, {
    ar: ([current, prior, sign, change]) => `حجم ${current} كغ مقابل ${prior} كغ في الأيام السبعة السابقة (${sign}${change}٪).`,
    es: ([current, prior, sign, change]) => `${current} kg de volumen frente a ${prior} kg en los siete días anteriores (${sign}${change} %).`,
    "zh-Hans": ([current, prior, sign, change]) => `训练容量 ${current} 千克，上一个七天为 ${prior} 千克（${sign}${change}%）。`,
    sv: ([current, prior, sign, change]) => `${current} kg volym jämfört med ${prior} kg under de föregående sju dagarna (${sign}${change} %).`,
    de: ([current, prior, sign, change]) => `${current} kg Volumen gegenüber ${prior} kg in den vorherigen sieben Tagen (${sign}${change} %).`,
    ru: ([current, prior, sign, change]) => `${current} кг объёма против ${prior} кг за предыдущие семь дней (${sign}${change} %).`,
    fr: ([current, prior, sign, change]) => `${current} kg de volume contre ${prior} kg au cours des sept jours précédents (${sign}${change} %).`,
  }),
  template(/^(.+?) leads your volume$/, {
    ar: ([name]) => `${localizeCaptured("ar", name)} يتصدر حجم تدريبك`,
    es: ([name]) => `${localizeCaptured("es", name)} lidera tu volumen`,
    "zh-Hans": ([name]) => `${localizeCaptured("zh-Hans", name)}是你的训练容量主力`,
    sv: ([name]) => `${localizeCaptured("sv", name)} leder din volym`,
    de: ([name]) => `${localizeCaptured("de", name)} führt bei deinem Volumen`,
    ru: ([name]) => `${localizeCaptured("ru", name)} лидирует по вашему объёму`,
    fr: ([name]) => `${localizeCaptured("fr", name)} domine votre volume`,
  }),
  template(/^(.+?) leads (.+)$/, {
    ar: ([name, metric]) => `${name} يتصدر ${localizeCaptured("ar", metric)}`,
    es: ([name, metric]) => `${name} lidera ${localizeCaptured("es", metric)}`,
    "zh-Hans": ([name, metric]) => `${name} 在${localizeCaptured("zh-Hans", metric)}中领先`,
    sv: ([name, metric]) => `${name} leder ${localizeCaptured("sv", metric)}`,
    de: ([name, metric]) => `${name} führt: ${localizeCaptured("de", metric)}`,
    ru: ([name, metric]) => `${name} лидирует по показателю «${localizeCaptured("ru", metric)}»`,
    fr: ([name, metric]) => `${name} mène pour ${localizeCaptured("fr", metric)}`,
  }),
  template(/^(.+?) passed (.+)$/, {
    ar: ([name, previous]) => `${name} تجاوز ${previous}`,
    es: ([name, previous]) => `${name} superó a ${previous}`,
    "zh-Hans": ([name, previous]) => `${name} 超过了 ${previous}`,
    sv: ([name, previous]) => `${name} gick om ${previous}`,
    de: ([name, previous]) => `${name} hat ${previous} überholt`,
    ru: ([name, previous]) => `${name} обошёл ${previous}`,
    fr: ([name, previous]) => `${name} a dépassé ${previous}`,
  }),
  template(/^([\d.,]+) steps$/, {
    ar: ([value]) => `${value} خطوة`,
    es: ([value]) => `${value} pasos`,
    "zh-Hans": ([value]) => `${value} 步`,
    sv: ([value]) => `${value} steg`,
    de: ([value]) => `${value} Schritte`,
    ru: ([value]) => `${value} шагов`,
    fr: ([value]) => `${value} pas`,
  }),
  template(/^(\d+) workout(s?) this week$/, {
    ar: ([value]) => `${value} ${value === "1" ? "تمرين" : "تمارين"} هذا الأسبوع`,
    es: ([value]) => `${value} ${value === "1" ? "entrenamiento" : "entrenamientos"} esta semana`,
    "zh-Hans": ([value]) => `本周 ${value} 次锻炼`,
    sv: ([value]) => `${value} ${value === "1" ? "träningspass" : "träningspass"} den här veckan`,
    de: ([value]) => `${value} ${value === "1" ? "Training" : "Trainings"} diese Woche`,
    ru: ([value]) => `${value} ${value === "1" ? "тренировка" : "тренировок"} на этой неделе`,
    fr: ([value]) => `${value} ${value === "1" ? "entraînement" : "entraînements"} cette semaine`,
  }),
  template(/^([+-]?)([\d.,]+) pts$/, {
    ar: ([sign, value]) => `${sign}${value} نقطة`,
    es: ([sign, value]) => `${sign}${value} ptos.`,
    "zh-Hans": ([sign, value]) => `${sign}${value} 分`,
    sv: ([sign, value]) => `${sign}${value} p`,
    de: ([sign, value]) => `${sign}${value} Pkt.`,
    ru: ([sign, value]) => `${sign}${value} балл.`,
    fr: ([sign, value]) => `${sign}${value} pts`,
  }),
  template(/^(\d+)s average rest$/, {
    ar: ([value]) => `متوسط الراحة ${value} ث`,
    es: ([value]) => `${value} s de descanso medio`,
    "zh-Hans": ([value]) => `平均休息 ${value} 秒`,
    sv: ([value]) => `${value} s genomsnittlig vila`,
    de: ([value]) => `${value} Sek. durchschnittliche Pause`,
    ru: ([value]) => `Средний отдых ${value} с`,
    fr: ([value]) => `${value} s de repos moyen`,
  }),
  template(/^Workout · (.+?) duration from saved or compatible connected-health sessions\.$/, {
    ar: ([category]) => `التمرين · مدة ${localizeCaptured("ar", category)} من الجلسات المحفوظة أو جلسات الصحة المتصلة المتوافقة.`,
    es: ([category]) => `Entrenamiento · duración de ${localizeCaptured("es", category)} a partir de sesiones guardadas o compatibles de salud conectada.`,
    "zh-Hans": ([category]) => `锻炼 · ${localizeCaptured("zh-Hans", category)}时长，来自已保存或兼容的互联健康训练。`,
    sv: ([category]) => `Träning · längd för ${localizeCaptured("sv", category)} från sparade eller kompatibla anslutna hälsopass.`,
    de: ([category]) => `Training · Dauer für ${localizeCaptured("de", category)} aus gespeicherten oder kompatiblen verbundenen Gesundheitseinheiten.`,
    ru: ([category]) => `Тренировка · длительность «${localizeCaptured("ru", category)}» из сохранённых или совместимых сессий подключённых сервисов здоровья.`,
    fr: ([category]) => `Entraînement · durée de ${localizeCaptured("fr", category)} issue des séances enregistrées ou compatibles de santé connectée.`,
  }),
  template(/^Current (.+?) leader for (.+)\.$/, {
    ar: ([metric, date]) => `متصدر ${localizeCaptured("ar", metric)} الحالي في ${localizeCaptured("ar", date)}.`,
    es: ([metric, date]) => `Líder actual de ${localizeCaptured("es", metric)} para ${localizeCaptured("es", date)}.`,
    "zh-Hans": ([metric, date]) => `${localizeCaptured("zh-Hans", date)}的${localizeCaptured("zh-Hans", metric)}当前领先者。`,
    sv: ([metric, date]) => `Nuvarande ledare i ${localizeCaptured("sv", metric)} för ${localizeCaptured("sv", date)}.`,
    de: ([metric, date]) => `Aktuell führend bei ${localizeCaptured("de", metric)} für ${localizeCaptured("de", date)}.`,
    ru: ([metric, date]) => `Текущий лидер по показателю «${localizeCaptured("ru", metric)}» за ${localizeCaptured("ru", date)}.`,
    fr: ([metric, date]) => `Leader actuel pour ${localizeCaptured("fr", metric)} à la date ${localizeCaptured("fr", date)}.`,
  }),
  template(/^New #1 in (.+?) today\.$/, {
    ar: ([metric]) => `متصدر جديد اليوم في ${localizeCaptured("ar", metric)}.`,
    es: ([metric]) => `Nuevo número 1 hoy en ${localizeCaptured("es", metric)}.`,
    "zh-Hans": ([metric]) => `今天${localizeCaptured("zh-Hans", metric)}的新榜首。`,
    sv: ([metric]) => `Ny etta i ${localizeCaptured("sv", metric)} idag.`,
    de: ([metric]) => `Heute neue Nummer 1 bei ${localizeCaptured("de", metric)}.`,
    ru: ([metric]) => `Сегодня новый лидер по показателю «${localizeCaptured("ru", metric)}».`,
    fr: ([metric]) => `Nouveau numéro 1 aujourd’hui pour ${localizeCaptured("fr", metric)}.`,
  }),
  template(/^Review (.+)$/, {
    ar: ([name]) => `راجع ${localizeCaptured("ar", name)}`,
    es: ([name]) => `Revisa ${localizeCaptured("es", name)}`,
    "zh-Hans": ([name]) => `检查${localizeCaptured("zh-Hans", name)}`,
    sv: ([name]) => `Se över ${localizeCaptured("sv", name)}`,
    de: ([name]) => `${localizeCaptured("de", name)} überprüfen`,
    ru: ([name]) => `Проверьте «${localizeCaptured("ru", name)}»`,
    fr: ([name]) => `Réévaluez ${localizeCaptured("fr", name)}`,
  }),
];

function template(
  expression: RegExp,
  render: Record<SecondaryLanguage, (values: string[]) => string>,
): Template {
  return { expression, render };
}

function localizeCaptured(language: AppLanguage, value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.toLocaleLowerCase("en");
  const metricName = caseInsensitiveMetricNames.get(normalized);
  if (metricName) return value.replace(trimmed, direct(language, metricName));
  const translated = direct(language, trimmed);
  if (translated !== trimmed) return value.replace(trimmed, translated);
  const canonical = caseInsensitiveDomainNames.get(normalized);
  if (canonical) return value.replace(trimmed, direct(language, canonical));
  const strength = /^(.*) strength$/i.exec(trimmed);
  if (strength && exerciseNames.has(strength[1])) {
    const exercise = direct(language, strength[1]);
    const suffix = direct(language, "strength");
    return `${exercise} ${suffix}`;
  }
  const volume = /^(.*) volume$/i.exec(trimmed);
  if (volume) return `${direct(language, volume[1])} ${direct(language, "volume")}`;
  const valueWithUnit = /^(.+?\d(?:[\d.,/+-]*))\s+(kg e1RM|mg\/dL|mmHg|bpm|steps|kcal|mcg|sets|reps|days?|hr|min|km|kg|mg|g|L|pts)$/i.exec(trimmed);
  if (valueWithUnit) {
    const canonicalUnit = [...translatedUnits].find(
      (unit) => unit.toLowerCase() === valueWithUnit[2].toLowerCase(),
    ) ?? valueWithUnit[2];
    return value.replace(trimmed, `${valueWithUnit[1]} ${direct(language, canonicalUnit)}`);
  }
  return value;
}

function arabicFor(value: string) {
  const translated = localizeCaptured("ar", value);
  return translated.startsWith("ال")
    ? `لل${translated.slice(2)}`
    : `لـ${translated}`;
}

/**
 * Translates known app-generated domain copy. Unknown text is returned exactly
 * as supplied, which is the privacy/safety boundary for names, notes and chat.
 */
export function translateDomainText(language: AppLanguage, source: string) {
  if (language === "en" || !source) return source;
  const directValue = direct(language, source);
  if (directValue !== source) return directValue;
  for (const item of templates) {
    const match = item.expression.exec(source);
    if (!match) continue;
    return item.render[language](match.slice(1).map((value) => localizeCaptured(language, value)));
  }
  const socialParts = socialRows
    .map((row) => row[0])
    .sort((a, b) => b.length - a.length);
  let social = source;
  let changed = false;
  for (const part of socialParts) {
    if (!social.includes(part)) continue;
    social = social.split(part).join(direct(language, part));
    changed = true;
  }
  if (changed) return social;
  const metricSuffix = /^(.*)\s+(strength|volume|reps)$/i.exec(source);
  if (metricSuffix) {
    const base = direct(language, metricSuffix[1]);
    if (base !== metricSuffix[1])
      return `${base} ${direct(language, metricSuffix[2].toLowerCase())}`;
  }
  // Numeric value plus a built-in unit (for cards, badges and pushes).
  const valueWithUnit = /^(.+?\d(?:[\d.,/+-]*))\s+(kg e1RM|mg\/dL|mmHg|bpm|steps|kcal|mcg|sets|reps|days?|hr|min|km|kg|mg|g|L|pts)$/i.exec(source);
  if (valueWithUnit) {
    const canonicalUnit = [...translatedUnits].find((unit) => unit.toLowerCase() === valueWithUnit[2].toLowerCase()) ?? valueWithUnit[2];
    return `${valueWithUnit[1]} ${direct(language, canonicalUnit)}`;
  }
  return source;
}

export type LocalizedPushCopy = Partial<Record<AppLanguage, string>>;

/** Precompute recipient-specific push copy without sending user content away. */
export function localizedPushText(source: string): LocalizedPushCopy {
  return Object.fromEntries(
    (["en", ...languages] as AppLanguage[]).map((language) => [
      language,
      translateDomainText(language, source),
    ]),
  );
}

export function localizeBadge<T extends { title: string; caption: string; description: string; owner: string }>(
  language: AppLanguage,
  badge: T,
): T {
  return {
    ...badge,
    title: translateDomainText(language, badge.title),
    caption: translateDomainText(language, badge.caption),
    description: translateDomainText(language, badge.description),
    owner: translateDomainText(language, badge.owner),
  };
}

export function localizeGeneratedCard<T extends { title: string; body: string }>(
  language: AppLanguage,
  card: T,
): T {
  return {
    ...card,
    title: translateDomainText(language, card.title),
    body: translateDomainText(language, card.body),
  };
}
