import { createContext, useContext, useState, useCallback, useEffect } from "react";

// Lightweight i18n for the customer app. Strings are keyed by their English
// text, so a component reads `t("My Cart")`. If a Hindi translation is missing
// the English shows through unchanged — so the app is never half-broken and we
// can grow coverage over time. Product/brand names are left as-is on purpose.
const HI = {
  // Header
  "Login": "लॉगिन",
  "My Cart": "मेरी कार्ट",
  "item": "वस्तु",
  "items": "वस्तुएँ",
  "Delivery in": "डिलीवरी",
  "min": "मिनट में",
  'Search "milk", "bread", "atta"...': 'खोजें "दूध", "ब्रेड", "आटा"...',
  // Home / sections
  "Buy again": "फिर से खरीदें",
  "Categories": "श्रेणियाँ",
  "All products": "सभी उत्पाद",
  "Welcome to Nisha General Store — daily essentials, delivered fast.":
    "निशा जनरल स्टोर में आपका स्वागत है — रोज़मर्रा का सामान, तेज़ डिलीवरी।",
  "Store closed": "दुकान बंद है",
  "We're closed right now": "हम अभी बंद हैं",
  "No results": "कोई परिणाम नहीं",
  "Nothing matched your search.": "आपकी खोज से कुछ मेल नहीं खाया।",
  // Product card
  "ADD": "जोड़ें",
  "Out of stock": "स्टॉक ख़त्म",
  "Best price": "सबसे अच्छा दाम",
  "Bestseller": "सबसे ज़्यादा बिकने वाला",
  "Notify me": "मुझे बताएं",
  "We'll tell you ✓": "हम बताएंगे ✓",
  "Add one": "एक जोड़ें",
  "Remove one": "एक हटाएँ",
  // Cart / checkout
  "Cart": "कार्ट",
  "Your cart is empty": "आपकी कार्ट खाली है",
  "Add items to get started": "शुरू करने के लिए सामान जोड़ें",
  "Item total": "वस्तु कुल",
  "Delivery fee": "डिलीवरी शुल्क",
  "Handling charge": "हैंडलिंग शुल्क",
  "Surge fee": "सर्ज शुल्क",
  "Total": "कुल",
  "Total paid": "कुल भुगतान",
  "To pay": "देय राशि",
  "FREE": "मुफ़्त",
  "Place Order": "ऑर्डर करें",
  "Placing order…": "ऑर्डर हो रहा है…",
  "Proceed to checkout": "चेकआउट करें",
  "Cash on delivery": "डिलीवरी पर नकद",
  "Pay online": "ऑनलाइन भुगतान",
  "Pay on delivery": "डिलीवरी पर भुगतान",
  "Delivery address": "डिलीवरी पता",
  "Add address": "पता जोड़ें",
  "Delivery time": "डिलीवरी समय",
  "Now": "अभी",
  "Add more items": "और सामान जोड़ें",
  // Order statuses
  "Placed": "ऑर्डर हुआ",
  "Packed": "पैक हुआ",
  "Out for delivery": "डिलीवरी के लिए निकला",
  "Delivered": "डिलीवर हो गया",
  "Scheduled": "निर्धारित",
  // Order tracking
  "Track order": "ऑर्डर ट्रैक करें",
  "Order status": "ऑर्डर स्थिति",
  "Order summary": "ऑर्डर सारांश",
  "Need help with this order?": "इस ऑर्डर में मदद चाहिए?",
  "Call delivery partner": "डिलीवरी पार्टनर को कॉल करें",
  "Call": "कॉल",
  "Your delivery partner": "आपका डिलीवरी पार्टनर",
  "Delivered — enjoy!": "डिलीवर हो गया — आनंद लें!",
  "Order delivered — enjoy!": "ऑर्डर डिलीवर हो गया — आनंद लें!",
  "Rate your order": "अपने ऑर्डर को रेट करें",
  "Submit feedback": "फ़ीडबैक भेजें",
  "Thanks for your feedback!": "आपके फ़ीडबैक के लिए धन्यवाद!",
  "Share my location": "मेरा स्थान साझा करें",
  "Your order is being prepared. You'll be able to call your delivery partner once it's on the way.":
    "आपका ऑर्डर तैयार हो रहा है। रास्ते में आने पर आप अपने डिलीवरी पार्टनर को कॉल कर पाएंगे।",
  // Account / common
  "Account": "खाता",
  "My orders": "मेरे ऑर्डर",
  "Log out": "लॉग आउट",
  "Log in": "लॉग इन",
  "Continue": "जारी रखें",
  "Cancel": "रद्द करें",
  "Save": "सहेजें",
  "Retry": "पुनः प्रयास",
  "Language": "भाषा",
  // Reliability
  "You're offline": "आप ऑफ़लाइन हैं",
  "Check your connection — we'll reconnect automatically.": "अपना कनेक्शन जांचें — हम अपने आप फिर से जुड़ जाएंगे।",
  "Back online": "फिर से ऑनलाइन",
};

const DICT = { en: {}, hi: HI };
const LangCtx = createContext({ lang: "en", t: (s) => s, setLang: () => {} });
export const useT = () => useContext(LangCtx);

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem("ngs_lang") || "en"; } catch { return "en"; }
  });
  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem("ngs_lang", l); } catch { /* ignore */ }
  }, []);
  useEffect(() => { try { document.documentElement.lang = lang; } catch { /* ignore */ } }, [lang]);
  const t = useCallback((s) => {
    const d = DICT[lang];
    return (d && d[s]) || s;
  }, [lang]);
  return <LangCtx.Provider value={{ lang, t, setLang }}>{children}</LangCtx.Provider>;
}
