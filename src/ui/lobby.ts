// Screen 2, the lobby: the ophthalmology-department waiting room (a looping clip), with the two modes printed on the frosted glass of the cabin doors.
// The clip's camera is fixed, so the doors sit at fixed places on a 16:9 stage that scales to fit the window.
import "./lobby.css";
import lobbyUrl from "../../assets/lobby/lobby.jpg?url";
import lobbyVideoUrl from "../../assets/lobby/lobby.mp4?url";

export type LobbyChoice = "prompt" | "random";

const OUT_MS = 450;   // fade-out, matches #lobby transition

const ICONS = {
  prompt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2"/></svg>`,
  random: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c5 0 6 10 11 10H21M3 17h3.5c1.6 0 2.8-.7 3.8-1.8M13.7 8.8C14.7 7.7 15.9 7 17.5 7H21"/><path d="M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>`,
};

const DOORS: { choice: LobbyChoice; title: string[]; text: string }[] = [
  { choice: "prompt", title: ["Create a", "Patient Case"], text: "Describe the patient or clinical scenario you want to practice." },
  { choice: "random", title: ["Assign Me", "a Patient"], text: "Get a clinically validated case from our curated scenarios." },
];

/** Shows the lobby over the page; resolves with the chosen mode once it has faded out. */
export function playLobby(): Promise<LobbyChoice> {
  const root = document.createElement("div");
  root.id = "lobby";
  root.className = "wait";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "VibeDoc ophthalmology department: choose how to start");
  root.innerHTML = `<div class="stage">
  <video class="bg" muted loop playsinline autoplay preload="auto" aria-hidden="true" tabindex="-1"></video>
  ${DOORS.map(d => `<button type="button" class="door ${d.choice}" data-choice="${d.choice}">
    <span class="icon">${ICONS[d.choice]}</span>
    <span class="title">${d.title.join("<br>")}</span>
    <span class="text">${d.text}</span>
    <span class="enter">Enter Cabin <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
  </button>`).join("")}
</div>`;
  const video = root.querySelector("video")!;
  video.muted = true; video.poster = lobbyUrl; video.src = lobbyVideoUrl;
  document.body.appendChild(root);
  video.play().catch(() => { /* autoplay refused: the poster stays up as a still */ });

  // The doors are shown together with the clip, not before it; a slow or failed load must not trap the trainee.
  const reveal = () => root.classList.remove("wait");
  if (video.readyState >= 3) reveal();
  else {
    video.addEventListener("canplay", reveal, { once: true });
    video.addEventListener("error", reveal, { once: true });
    setTimeout(reveal, 8000);
  }

  return new Promise(resolve => {
    root.addEventListener("click", e => {
      const door = (e.target as Element).closest<HTMLElement>(".door");
      if (!door || root.classList.contains("out")) return;
      root.classList.add("out");
      setTimeout(() => { video.pause(); root.remove(); resolve(door.dataset.choice as LobbyChoice); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : OUT_MS);
    });
  });
}
