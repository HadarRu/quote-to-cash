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
} as const;

export type Strings = typeof he;
