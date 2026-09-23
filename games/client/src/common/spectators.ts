export interface Spectator { id: string; displayName: string; avatarUrl?: string | null }

export function createSpectatorBar(parent: HTMLElement) {
  const bar = document.createElement("section");
  bar.className = "spectator-bar";
  bar.setAttribute("aria-label", "관전자");
  const count = document.createElement("strong"), list = document.createElement("ul");
  bar.append(count, list); parent.append(bar);
  let previous = "";
  return (spectators: Spectator[], online: boolean) => {
    bar.hidden = !online;
    const key = JSON.stringify(spectators);
    if (previous === key) return;
    previous = key; count.textContent = `관전자 ${spectators.length}`;
    list.replaceChildren();
    for (const spectator of spectators) {
      const item = document.createElement("li"), avatar = document.createElement("span"), name = document.createElement("span");
      avatar.className = "spectator-avatar";
      avatar.textContent = spectator.displayName.slice(0, 1);
      if (spectator.avatarUrl?.startsWith("https://cdn.discordapp.com/")) {
        const image = document.createElement("img");
        image.src = spectator.avatarUrl; image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
        image.onerror = () => image.remove();
        avatar.append(image);
      }
      name.textContent = spectator.displayName; item.title = spectator.displayName;
      item.append(avatar, name); list.append(item);
    }
  };
}
