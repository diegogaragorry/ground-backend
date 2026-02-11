"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TEMPLATES = void 0;
// src/auth/defaultTemplates.ts
// category/description are stored in DB (English); categoryKey/descriptionKey are for i18n on frontend.
exports.DEFAULT_TEMPLATES = [
    // FIXED
    { type: "FIXED", category: "Housing", categoryKey: "housing", description: "Rent", descriptionKey: "rent" },
    { type: "FIXED", category: "Housing", categoryKey: "housing", description: "Building Fees", descriptionKey: "building_fees" },
    { type: "FIXED", category: "Housing", categoryKey: "housing", description: "Property Taxes", descriptionKey: "property_taxes" },
    { type: "FIXED", category: "Domestic Staff", categoryKey: "domestic_staff", description: "Household Staff Salary", descriptionKey: "household_staff_salary" },
    { type: "FIXED", category: "Domestic Staff", categoryKey: "domestic_staff", description: "Social Security", descriptionKey: "social_security" },
    { type: "FIXED", category: "Connectivity", categoryKey: "connectivity", description: "Internet / Fiber", descriptionKey: "internet_fiber" },
    { type: "FIXED", category: "Connectivity", categoryKey: "connectivity", description: "Mobile Phone", descriptionKey: "mobile_phone" },
    { type: "FIXED", category: "Connectivity", categoryKey: "connectivity", description: "Cloud Storage", descriptionKey: "cloud_storage" },
    { type: "FIXED", category: "Connectivity", categoryKey: "connectivity", description: "Streaming Services", descriptionKey: "streaming_services" },
    { type: "FIXED", category: "Utilities", categoryKey: "utilities", description: "Electricity", descriptionKey: "electricity" },
    { type: "FIXED", category: "Utilities", categoryKey: "utilities", description: "Gas", descriptionKey: "gas" },
    { type: "FIXED", category: "Health & Wellness", categoryKey: "health_wellness", description: "Private Health Insurance", descriptionKey: "private_health_insurance" },
    { type: "FIXED", category: "Health & Wellness", categoryKey: "health_wellness", description: "Gym Membership", descriptionKey: "gym_membership" },
    // VARIABLE
    { type: "VARIABLE", category: "Food & Grocery", categoryKey: "food_grocery", description: "Groceries", descriptionKey: "groceries" },
    { type: "VARIABLE", category: "Transport", categoryKey: "transport", description: "Fuel", descriptionKey: "fuel" },
    { type: "VARIABLE", category: "Transport", categoryKey: "transport", description: "Vehicle Taxes", descriptionKey: "vehicle_taxes" },
    { type: "VARIABLE", category: "Transport", categoryKey: "transport", description: "Tolls", descriptionKey: "tolls" },
    { type: "VARIABLE", category: "Transport", categoryKey: "transport", description: "Ride Sharing / Taxis", descriptionKey: "ride_sharing_taxis" },
    { type: "VARIABLE", category: "Transport", categoryKey: "transport", description: "Public Transport", descriptionKey: "public_transport" },
    { type: "VARIABLE", category: "Dining & Leisure", categoryKey: "dining_leisure", description: "Restaurants", descriptionKey: "restaurants" },
    { type: "VARIABLE", category: "Dining & Leisure", categoryKey: "dining_leisure", description: "Coffee & Snacks", descriptionKey: "coffee_snacks" },
    { type: "VARIABLE", category: "Dining & Leisure", categoryKey: "dining_leisure", description: "Delivery", descriptionKey: "delivery" },
    { type: "VARIABLE", category: "Dining & Leisure", categoryKey: "dining_leisure", description: "Events & Concerts", descriptionKey: "events_concerts" },
    { type: "VARIABLE", category: "Sports", categoryKey: "sports", description: "Tenis, Surf, Football / Others", descriptionKey: "sports_others" },
    { type: "VARIABLE", category: "Wellness", categoryKey: "wellness", description: "Pharmacy", descriptionKey: "pharmacy" },
    { type: "VARIABLE", category: "Wellness", categoryKey: "wellness", description: "Personal Care", descriptionKey: "personal_care" },
    { type: "VARIABLE", category: "Wellness", categoryKey: "wellness", description: "Medical / Dental", descriptionKey: "medical_dental" },
    { type: "VARIABLE", category: "Gifts & Social", categoryKey: "gifts_social", description: "Holiday Gifts", descriptionKey: "holiday_gifts" },
    { type: "VARIABLE", category: "Gifts & Social", categoryKey: "gifts_social", description: "Donations / Raffles", descriptionKey: "donations_raffles" },
    { type: "VARIABLE", category: "Other", categoryKey: "other", description: "Others", descriptionKey: "others" },
];
