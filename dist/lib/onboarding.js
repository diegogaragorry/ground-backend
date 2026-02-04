"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onbKey = onbKey;
exports.readOnbForUser = readOnbForUser;
exports.writeOnbForUser = writeOnbForUser;
const ONB_PREFIX = "ground:onboarding:v1:";
function onbKey(userId) {
    return `${ONB_PREFIX}${userId}`;
}
function readOnbForUser(userId) {
    try {
        const raw = localStorage.getItem(onbKey(userId));
        if (!raw)
            return { step: 1, dismissed: false };
        const parsed = JSON.parse(raw);
        const step = Number(parsed?.step);
        if (step >= 1 && step <= 5)
            return { step: step, dismissed: !!parsed?.dismissed };
        return { step: 1, dismissed: false };
    }
    catch {
        return { step: 1, dismissed: false };
    }
}
function writeOnbForUser(userId, next) {
    localStorage.setItem(onbKey(userId), JSON.stringify(next));
}
