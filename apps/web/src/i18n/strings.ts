import type { Locale } from '@mc/types'

/**
 * Translations. Section 29.
 *
 * A plain typed object rather than i18next: the whole requirement is two
 * languages and no plural rules beyond simple ones, and a 40 KB library to
 * look up keys in a record would be weight for nothing. `Strings` is derived
 * from the English table, so a missing Hindi key is a TYPE ERROR - which is
 * the property that actually keeps translations honest.
 *
 * Hindi is Devanagari (assumption A8). Hinglish matters for voice input in a
 * later phase, not for the interface.
 */

export const en = {
  // shell
  appName: 'Matrix Construction',
  signOut: 'Sign out',
  signInWithGoogle: 'Sign in with Google',
  loading: 'Loading…',
  cancel: 'Cancel',
  save: 'Save',
  tryAgain: 'Try again',

  // nav
  navDashboard: 'Dashboard',
  navAttendance: 'Attendance',
  navProjects: 'Projects',
  navLabour: 'Labour',
  navWages: 'Wages',
  navReports: 'Reports',
  navClients: 'Clients',
  navUsers: 'Users',
  navSettings: 'Settings',

  // dashboard
  greeting: 'Namaste',
  today: 'Today',

  // attendance - the screen a supervisor uses every single day
  attendanceTitle: 'Attendance',
  project: 'Project',
  date: 'Date',
  present: 'Present',
  absent: 'Absent',
  halfDay: 'Half day',
  leave: 'Leave',
  holiday: 'Holiday',
  marked: 'marked',
  allMarked: 'All marked',
  remaining: 'left',
  offlineTitle: 'You are offline.',
  offlineBody: 'Attendance is saved on this phone and will sync by itself when there is signal.',
  noLabourAssigned: 'No labourers assigned to this project yet.',
  futureDate: 'Attendance can only be marked up to today.',

  // money
  contractValue: 'Contract value',
  billed: 'Billed',
  received: 'Received',
  receivable: 'Receivable',
  unbilledBalance: 'Unbilled balance',
  contractRemaining: 'Contract remaining',
  labourEarned: 'Labour earned',
  labourPaid: 'Labour paid',
  labourPayable: 'Labour payable',
  expenses: 'Expenses',
  cashPosition: 'Cash position',

  // wages
  wagesTitle: 'Wages',
  days: 'Days',
  rate: 'Rate',
  earned: 'Earned',
  paid: 'Paid',
  payable: 'Payable',
  pay: 'Pay',
  advance: 'advance',

  // access
  waitingForAccess: 'Waiting for access',
  waitingForAccessBody:
    'You are signed in to Google, but this account has not been given access yet. Ask the owner to add you.',
  yourAccountId: 'Your account ID',
  signedInAs: 'Signed in as',
  noMoneyForRole: 'Financial figures are not shown for your role.',
} as const

export type StringKey = keyof typeof en
export type Strings = Record<StringKey, string>

export const hi: Strings = {
  appName: 'मैट्रिक्स कंस्ट्रक्शन',
  signOut: 'साइन आउट',
  signInWithGoogle: 'Google से साइन इन करें',
  loading: 'लोड हो रहा है…',
  cancel: 'रद्द करें',
  save: 'सेव करें',
  tryAgain: 'फिर कोशिश करें',

  navDashboard: 'डैशबोर्ड',
  navAttendance: 'हाज़िरी',
  navProjects: 'प्रोजेक्ट',
  navLabour: 'मज़दूर',
  navWages: 'मज़दूरी',
  navReports: 'रिपोर्ट',
  navClients: 'क्लाइंट',
  navUsers: 'यूज़र',
  navSettings: 'सेटिंग',

  greeting: 'नमस्ते',
  today: 'आज',

  attendanceTitle: 'हाज़िरी',
  project: 'प्रोजेक्ट',
  date: 'तारीख़',
  present: 'हाज़िर',
  absent: 'ग़ैरहाज़िर',
  halfDay: 'आधा दिन',
  leave: 'छुट्टी',
  holiday: 'अवकाश',
  marked: 'दर्ज',
  allMarked: 'सब दर्ज हो गए',
  remaining: 'बाक़ी',
  offlineTitle: 'आप ऑफ़लाइन हैं।',
  offlineBody: 'हाज़िरी इसी फ़ोन में सेव हो रही है और नेटवर्क आते ही अपने आप भेज दी जाएगी।',
  noLabourAssigned: 'इस प्रोजेक्ट में अभी कोई मज़दूर नहीं जोड़ा गया है।',
  futureDate: 'हाज़िरी आज तक की ही दर्ज हो सकती है।',

  contractValue: 'ठेका राशि',
  billed: 'बिल किया',
  received: 'प्राप्त',
  receivable: 'लेना बाक़ी',
  unbilledBalance: 'बिल बाक़ी',
  contractRemaining: 'ठेका बाक़ी',
  labourEarned: 'मज़दूरी बनी',
  labourPaid: 'मज़दूरी दी',
  labourPayable: 'मज़दूरी बाक़ी',
  expenses: 'ख़र्च',
  cashPosition: 'नक़द स्थिति',

  wagesTitle: 'मज़दूरी',
  days: 'दिन',
  rate: 'दर',
  earned: 'बनी',
  paid: 'दी गई',
  payable: 'बाक़ी',
  pay: 'भुगतान',
  advance: 'अग्रिम',

  waitingForAccess: 'अनुमति का इंतज़ार',
  waitingForAccessBody:
    'आप Google से साइन इन हैं, लेकिन इस खाते को अभी अनुमति नहीं मिली है। मालिक से जोड़ने को कहें।',
  yourAccountId: 'आपकी खाता आईडी',
  signedInAs: 'साइन इन:',
  noMoneyForRole: 'आपकी भूमिका के लिए वित्तीय आंकड़े नहीं दिखाए जाते।',
}

export const TRANSLATIONS: Record<Locale, Strings> = { en, hi }
