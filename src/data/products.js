// Product catalog for NGS Store.
// Images are represented as emoji so the app is fully self-contained and
// works offline with no external asset requests. Prices are in ₹ (INR).

export const categories = [
  { id: "fruits-veg", name: "Fruits & Vegetables", icon: "🥬", color: "#e7f7e9" },
  { id: "dairy-bread", name: "Dairy, Bread & Eggs", icon: "🥛", color: "#fdf4e3" },
  { id: "snacks", name: "Snacks & Munchies", icon: "🍿", color: "#fce8ec" },
  { id: "beverages", name: "Cold Drinks & Juices", icon: "🥤", color: "#e6f0fb" },
  { id: "instant", name: "Instant & Frozen Food", icon: "🍜", color: "#f3ecfb" },
  { id: "bakery", name: "Bakery & Sweets", icon: "🧁", color: "#fdeae6" },
  { id: "personal", name: "Personal Care", icon: "🧴", color: "#e7f6f6" },
  { id: "household", name: "Cleaning & Household", icon: "🧹", color: "#eef2e6" },
];

export const products = [
  // Fruits & Vegetables
  { id: "p1", name: "Fresh Banana", unit: "6 pcs", price: 40, mrp: 55, icon: "🍌", category: "fruits-veg" },
  { id: "p2", name: "Red Apple (Shimla)", unit: "4 pcs", price: 120, mrp: 160, icon: "🍎", category: "fruits-veg" },
  { id: "p3", name: "Tomato", unit: "500 g", price: 25, mrp: 35, icon: "🍅", category: "fruits-veg" },
  { id: "p4", name: "Onion", unit: "1 kg", price: 38, mrp: 50, icon: "🧅", category: "fruits-veg" },
  { id: "p5", name: "Potato", unit: "1 kg", price: 32, mrp: 45, icon: "🥔", category: "fruits-veg" },
  { id: "p6", name: "Fresh Spinach", unit: "250 g", price: 20, mrp: 30, icon: "🥬", category: "fruits-veg" },
  { id: "p7", name: "Carrot", unit: "500 g", price: 34, mrp: 45, icon: "🥕", category: "fruits-veg" },
  { id: "p8", name: "Green Grapes", unit: "500 g", price: 70, mrp: 90, icon: "🍇", category: "fruits-veg" },

  // Dairy, Bread & Eggs
  { id: "p9", name: "Amul Toned Milk", unit: "500 ml", price: 27, mrp: 30, icon: "🥛", category: "dairy-bread" },
  { id: "p10", name: "Brown Bread", unit: "400 g", price: 45, mrp: 50, icon: "🍞", category: "dairy-bread" },
  { id: "p11", name: "Farm Eggs", unit: "6 pcs", price: 66, mrp: 78, icon: "🥚", category: "dairy-bread" },
  { id: "p12", name: "Amul Butter", unit: "100 g", price: 56, mrp: 60, icon: "🧈", category: "dairy-bread" },
  { id: "p13", name: "Paneer", unit: "200 g", price: 89, mrp: 99, icon: "🧀", category: "dairy-bread" },
  { id: "p14", name: "Curd (Dahi)", unit: "400 g", price: 40, mrp: 45, icon: "🥣", category: "dairy-bread" },

  // Snacks & Munchies
  { id: "p15", name: "Lay's Classic Salted", unit: "52 g", price: 20, mrp: 20, icon: "🥔", category: "snacks" },
  { id: "p16", name: "Kurkure Masala Munch", unit: "90 g", price: 20, mrp: 20, icon: "🌶️", category: "snacks" },
  { id: "p17", name: "Salted Peanuts", unit: "200 g", price: 55, mrp: 70, icon: "🥜", category: "snacks" },
  { id: "p18", name: "Popcorn (Butter)", unit: "70 g", price: 35, mrp: 40, icon: "🍿", category: "snacks" },
  { id: "p19", name: "Dark Chocolate", unit: "80 g", price: 90, mrp: 110, icon: "🍫", category: "snacks" },
  { id: "p20", name: "Digestive Biscuits", unit: "250 g", price: 45, mrp: 55, icon: "🍪", category: "snacks" },

  // Cold Drinks & Juices
  { id: "p21", name: "Coca-Cola", unit: "750 ml", price: 40, mrp: 45, icon: "🥤", category: "beverages" },
  { id: "p22", name: "Orange Juice", unit: "1 L", price: 99, mrp: 120, icon: "🧃", category: "beverages" },
  { id: "p23", name: "Mineral Water", unit: "1 L", price: 20, mrp: 22, icon: "💧", category: "beverages" },
  { id: "p24", name: "Cold Coffee", unit: "180 ml", price: 45, mrp: 50, icon: "☕", category: "beverages" },
  { id: "p25", name: "Green Tea", unit: "25 bags", price: 150, mrp: 199, icon: "🍵", category: "beverages" },
  { id: "p26", name: "Fresh Lime Soda", unit: "300 ml", price: 30, mrp: 35, icon: "🍋", category: "beverages" },

  // Instant & Frozen Food
  { id: "p27", name: "Maggi Noodles", unit: "4 pack", price: 55, mrp: 60, icon: "🍜", category: "instant" },
  { id: "p28", name: "Frozen Green Peas", unit: "500 g", price: 85, mrp: 100, icon: "🫛", category: "instant" },
  { id: "p29", name: "Veg Momos", unit: "10 pcs", price: 120, mrp: 150, icon: "🥟", category: "instant" },
  { id: "p30", name: "French Fries", unit: "420 g", price: 99, mrp: 130, icon: "🍟", category: "instant" },
  { id: "p31", name: "Ready Poha Mix", unit: "200 g", price: 45, mrp: 55, icon: "🍲", category: "instant" },

  // Bakery & Sweets
  { id: "p32", name: "Chocolate Muffin", unit: "2 pcs", price: 60, mrp: 75, icon: "🧁", category: "bakery" },
  { id: "p33", name: "Fresh Croissant", unit: "1 pc", price: 55, mrp: 65, icon: "🥐", category: "bakery" },
  { id: "p34", name: "Gulab Jamun", unit: "500 g", price: 140, mrp: 180, icon: "🍮", category: "bakery" },
  { id: "p35", name: "Doughnut", unit: "1 pc", price: 45, mrp: 55, icon: "🍩", category: "bakery" },
  { id: "p36", name: "Rasgulla Tin", unit: "1 kg", price: 175, mrp: 220, icon: "🍥", category: "bakery" },

  // Personal Care
  { id: "p37", name: "Toothpaste", unit: "150 g", price: 95, mrp: 110, icon: "🪥", category: "personal" },
  { id: "p38", name: "Handwash Refill", unit: "750 ml", price: 99, mrp: 145, icon: "🧴", category: "personal" },
  { id: "p39", name: "Shampoo", unit: "340 ml", price: 199, mrp: 260, icon: "🧴", category: "personal" },
  { id: "p40", name: "Bath Soap (4 pack)", unit: "4 x 100 g", price: 120, mrp: 160, icon: "🧼", category: "personal" },
  { id: "p41", name: "Face Wash", unit: "100 ml", price: 149, mrp: 199, icon: "🧴", category: "personal" },

  // Cleaning & Household
  { id: "p42", name: "Dishwash Gel", unit: "750 ml", price: 110, mrp: 145, icon: "🧽", category: "household" },
  { id: "p43", name: "Floor Cleaner", unit: "1 L", price: 175, mrp: 220, icon: "🧹", category: "household" },
  { id: "p44", name: "Detergent Powder", unit: "1 kg", price: 145, mrp: 180, icon: "🧺", category: "household" },
  { id: "p45", name: "Garbage Bags", unit: "30 pcs", price: 99, mrp: 130, icon: "🗑️", category: "household" },
  { id: "p46", name: "Toilet Cleaner", unit: "500 ml", price: 89, mrp: 110, icon: "🚽", category: "household" },
];

export function getProductsByCategory(categoryId) {
  return products.filter((p) => p.category === categoryId);
}

export function searchProducts(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return products.filter((p) => p.name.toLowerCase().includes(q));
}
