// src/lib/onboarding.ts
export type OnbState = { step: 1 | 2 | 3 | 4 | 5; dismissed?: boolean };

const ONB_PREFIX = "ground:onboarding:v1:";

export function onbKey(userId: string) {
  return `${ONB_PREFIX}${userId}`;
}

export function readOnbForUser(userId: string): OnbState {
  try {
    const raw = localStorage.getItem(onbKey(userId));
    if (!raw) return { step: 1, dismissed: false };
    const parsed = JSON.parse(raw);
    const step = Number(parsed?.step);
    if (step >= 1 && step <= 5) return { step: step as 1 | 2 | 3 | 4 | 5, dismissed: !!parsed?.dismissed };
    return { step: 1, dismissed: false };
  } catch {
    return { step: 1, dismissed: false };
  }
}

export function writeOnbForUser(userId: string, next: OnbState) {
  localStorage.setItem(onbKey(userId), JSON.stringify(next));
}