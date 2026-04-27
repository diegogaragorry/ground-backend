"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterVisiblePlannedRows = filterVisiblePlannedRows;
const prisma_1 = require("./prisma");
const defaultTemplates_1 = require("../auth/defaultTemplates");
const ES_TEMPLATE_DESCRIPTIONS = {
    rent: ["Alquiler"],
    mortgage: ["Hipoteca"],
    building_fees: ["Gastos comunes"],
    property_taxes: ["Impuestos inmobiliarios"],
    household_staff_salary: ["Sueldo personal domestico"],
    social_security: ["Seguridad social"],
    internet_fiber: ["Internet / Fibra"],
    mobile_phone: ["Celular"],
    cloud_storage: ["Almacenamiento en la nube", "lmacenamiento en la nube"],
    streaming_services: ["Streaming"],
    tv_cable: ["TV / Cable"],
    other_online: ["Otros online (Spotify, etc.)"],
    electricity: ["Electricidad"],
    water: ["Agua"],
    gas: ["Gas"],
    private_health_insurance: ["Obra social / Seguro medico"],
    gym_membership: ["Gimnasio"],
    groceries: ["Supermercado"],
    fuel: ["Combustible"],
    vehicle_taxes: ["Impuestos vehiculares"],
    tolls: ["Peajes"],
    ride_sharing_taxis: ["Taxi / Uber"],
    public_transport: ["Transporte publico"],
    restaurants: ["Restaurantes"],
    coffee_snacks: ["Cafe y snacks"],
    delivery: ["Delivery"],
    events_concerts: ["Eventos y conciertos"],
    sports_others: ["Tenis, surf, futbol u otros"],
    pharmacy: ["Farmacia"],
    personal_care: ["Cuidado personal"],
    medical_dental: ["Medico / Dental"],
    psychologist: ["Psicologo/a"],
    holiday_gifts: ["Regalos de fiestas"],
    donations_raffles: ["Donaciones / Rifas"],
    others: ["Otros"],
};
const DEFAULT_DESCRIPTION_KEY_BY_DESCRIPTION_AND_TYPE = new Map(defaultTemplates_1.DEFAULT_TEMPLATES.map((template) => [`${template.description}|${template.type}`, template.descriptionKey]));
function normalizeDescription(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}
function plannedTemplateKey(row, description) {
    return [
        String(row.expenseType ?? "").trim(),
        String(row.categoryId ?? "").trim(),
        normalizeDescription(description),
    ].join("::");
}
function hiddenTemplateKeys(template) {
    const descriptionKey = template.descriptionKey ??
        DEFAULT_DESCRIPTION_KEY_BY_DESCRIPTION_AND_TYPE.get(`${template.description}|${template.expenseType}`);
    const aliases = [
        template.description,
        ...(descriptionKey ? ES_TEMPLATE_DESCRIPTIONS[descriptionKey] ?? [] : []),
    ];
    return aliases.map((alias) => plannedTemplateKey(template, alias));
}
async function filterVisiblePlannedRows(userId, rows) {
    const orphanDrafts = rows.filter((row) => row.templateId == null && row.isConfirmed !== true);
    if (orphanDrafts.length === 0)
        return rows;
    const hiddenTemplates = await prisma_1.prisma.expenseTemplate.findMany({
        where: { userId, showInExpenses: false },
        select: { expenseType: true, categoryId: true, description: true, descriptionKey: true },
    });
    if (hiddenTemplates.length === 0)
        return rows;
    const hiddenKeys = new Set(hiddenTemplates.flatMap(hiddenTemplateKeys));
    return rows.filter((row) => {
        if (row.templateId != null || row.isConfirmed === true)
            return true;
        return !hiddenKeys.has(plannedTemplateKey(row, row.description));
    });
}
