/** All user-facing strings. Hebrew is the only locale for now. */
export const he = {
  app: {
    name: 'מהצעה לתשלום',
    tagline: 'הצעות מחיר, עבודות וחשבוניות לבעלי מקצוע',
  },
  home: {
    title: 'ברוכים הבאים',
    subtitle: 'השלד של האפליקציה מוכן. הממשק מוצג מימין לשמאל.',
    flowTitle: 'תהליך העבודה',
    sampleTitle: 'דוגמאות עיצוב',
    sampleAmountLabel: 'סכום לדוגמה',
    samplePhoneLabel: 'טלפון לדוגמה',
    directionLabel: 'כיוון תצוגה',
    directionRtl: 'מימין לשמאל',
    directionLtr: 'משמאל לימין',
  },
  flow: {
    customer: 'לקוח',
    quote: 'הצעת מחיר',
    approval: 'אישור',
    scheduling: 'תיאום',
    job: 'עבודה',
    invoice: 'חשבונית',
    payment: 'תשלום',
  },
  states: {
    loading: 'טוען…',
    error: 'משהו השתבש',
    retry: 'נסו שוב',
    empty: 'אין עדיין נתונים',
    notFound: 'העמוד לא נמצא',
    backHome: 'חזרה לדף הבית',
  },
  splash: {
    loading: 'מתחברים…',
  },
  onboarding: {
    skip: 'דלגו',
    next: 'הבא',
    start: 'בואו נתחיל',
    stepOf: 'שלב {current} מתוך {total}',
    slides: [
      { title: 'הצעת מחיר בדקה', body: 'בונים הצעה מקצועית מהטלפון ושולחים ללקוח בקישור.' },
      { title: 'הלקוח מאשר וקובע מועד', body: 'הלקוח מאשר את ההצעה ובוחר מועד שמתאים לכם.' },
      { title: 'מהעבודה לחשבונית', body: 'מסיימים עבודה, מפיקים חשבונית ומקבלים תשלום.' },
    ],
  },
  auth: {
    phoneTitle: 'כניסה או הרשמה',
    phoneSubtitle: 'נשלח לכם קוד חד־פעמי ב־SMS',
    phoneLabel: 'מספר טלפון נייד',
    phonePlaceholder: '050-123-4567',
    sendCode: 'שליחת קוד',
    codeTitle: 'הזינו את הקוד',
    codeSentTo: 'שלחנו קוד בן 6 ספרות למספר {phone}',
    codeLabel: 'קוד אימות',
    verify: 'אימות',
    resend: 'שליחת קוד חדש',
    resendIn: 'אפשר לשלוח קוד חדש בעוד {seconds} שניות',
    codeResent: 'שלחנו קוד חדש',
    attemptsLeft: 'נותרו {attempts} ניסיונות',
    changeNumber: 'שינוי מספר',
  },
  setup: {
    title: 'פרטי העסק',
    subtitle: 'עוד רגע מתחילים. אפשר לשנות את הכול אחר כך.',
    nameLabel: 'שם העסק',
    namePlaceholder: 'לדוגמה: כהן חשמל',
    logoLabel: 'לוגו (לא חובה)',
    logoPick: 'בחירת לוגו',
    logoChange: 'החלפת לוגו',
    logoRemove: 'הסרה',
    logoHint: 'עד 2MB, בפורמט PNG‏, JPG או WebP',
    tradeLabel: 'תחום',
    taxStatusLabel: 'סוג עוסק',
    submit: 'יצירת העסק',
    trades: {
      electrician: 'חשמלאי',
      plumber: 'אינסטלטור',
      hvac: 'מיזוג אוויר',
      handyman: 'הנדימן',
      locksmith: 'מנעולן',
      painter: 'צבעי',
      other: 'אחר',
    },
    taxStatuses: {
      osek_patur: 'עוסק פטור',
      osek_murshe: 'עוסק מורשה',
      company: 'חברה בע״מ',
    },
  },
  appHome: {
    greeting: 'שלום, {name}',
    emptyTitle: 'עדיין אין הצעות מחיר',
    emptyBody: 'ההצעה הראשונה שלכם תופיע כאן.',
    settings: 'הגדרות',
  },
  settings: {
    title: 'הגדרות',
    account: 'חשבון',
    phone: 'טלפון',
    recoveryEmail: 'אימייל לשחזור',
    notSet: 'לא הוגדר',
    pendingConfirmation: 'ממתין לאישור: {email}',
    changePhone: 'החלפת מספר טלפון',
    setRecoveryEmail: 'הגדרת אימייל לשחזור',
    logout: 'התנתקות',
    logoutConfirm: 'להתנתק מהחשבון?',
    logoutYes: 'כן, להתנתק',
    cancel: 'ביטול',
    back: 'חזרה',
  },
  changePhone: {
    title: 'החלפת מספר טלפון',
    stepCurrent: 'קודם נוודא שזה אתם: נשלח קוד למספר הנוכחי {phone}.',
    sendToCurrent: 'שליחת קוד למספר הנוכחי',
    stepNew: 'עכשיו הזינו את המספר החדש. נשלח אליו קוד לאימות.',
    newPhoneLabel: 'מספר חדש',
    sendToNew: 'שליחת קוד למספר החדש',
    samePhone: 'זה המספר הנוכחי שלכם',
    done: 'המספר עודכן ל־{phone}',
  },
  recoveryEmail: {
    title: 'אימייל לשחזור',
    body: 'אם תאבדו גישה למספר הטלפון, נוכל לאמת אתכם דרך האימייל.',
    label: 'אימייל',
    placeholder: 'name@example.com',
    save: 'שמירה',
    sent: 'שלחנו קישור אימות ל־{email}. האימייל יופעל אחרי האישור.',
  },
  errors: {
    generic: 'משהו השתבש. נסו שוב.',
    network: 'אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.',
    config: 'האפליקציה לא הוגדרה: חסרים פרטי חיבור לשרת.',
    phone_invalid: 'מספר טלפון לא תקין. הזינו מספר ישראלי, למשל 050-123-4567.',
    code_format: 'הקוד מורכב מ־6 ספרות',
    code_invalid: 'הקוד שגוי או שפג תוקפו',
    too_many_attempts: 'יותר מדי ניסיונות. שלחו קוד חדש.',
    cooldown: 'אפשר לשלוח קוד חדש בעוד {seconds} שניות',
    too_many_sends: 'נשלחו יותר מדי קודים. נסו שוב בעוד כמה דקות.',
    rate_limited: 'יותר מדי בקשות. נסו שוב בעוד דקה.',
    not_authenticated: 'פג תוקף ההתחברות. התחברו שוב.',
    forbidden: 'אין לכם הרשאה לפעולה הזו',
    business_name_too_short: 'שם העסק קצר מדי',
    business_name_too_long: 'שם העסק ארוך מדי (עד 80 תווים)',
    business_id_invalid: 'משהו השתבש. נסו שוב.',
    trade_required: 'בחרו תחום',
    tax_status_required: 'בחרו סוג עוסק',
    logo_type_invalid: 'אפשר להעלות רק קובצי PNG‏, JPG או WebP',
    logo_too_large: 'הקובץ גדול מדי (עד 2MB)',
    logo_upload_failed: 'העסק נוצר, אבל העלאת הלוגו נכשלה. נסו שוב.',
    email_invalid: 'כתובת אימייל לא תקינה',
  },
} as const;
export type ErrorKey = keyof typeof he.errors;

/** Fills `{name}` placeholders: format('שלום, {name}', { name: 'דנה' }). */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Message for an error key; unknown keys fall back to the generic error. */
export function errorMessage(key: string, values: Record<string, string | number> = {}): string {
  const template = (he.errors as Record<string, string>)[key] ?? he.errors.generic;
  return format(template, values);
}

export type Strings = typeof he;
