// A small saved bank of image topics, kept in the browser so a topic typed
// once can be reused with a click next time.

const KEY = "banner-topics";

export function getTopics(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function addTopic(topic: string): string[] {
  const t = topic.trim();
  if (!t) return getTopics();
  const list = getTopics().filter((x) => x.toLowerCase() !== t.toLowerCase());
  list.unshift(t);
  const trimmed = list.slice(0, 40);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore storage errors */
  }
  return trimmed;
}

export function removeTopic(topic: string): string[] {
  const list = getTopics().filter((x) => x !== topic);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}
