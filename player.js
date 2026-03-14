/**
 * WildFireAudio — player.js
 *
 * Features:
 *  - Playlist (built-in demo tracks + drag-and-drop / file-picker upload)
 *  - Play / Pause / Previous / Next
 *  - Seek bar with live fill gradient
 *  - Volume control + Mute
 *  - Playback speed selector (0.5×–2×)
 *  - Shuffle & Repeat (none / one / all)
 *  - 5-band equaliser (Web Audio API)
 *  - Canvas frequency visualiser
 *  - Favourite track toggle
 *  - Dark / Light theme toggle
 *  - Keyboard shortcuts
 *  - Toast notifications
 *  - Drag-and-drop file loading
 */

/* ─────────────────────────────────────────────────────────────
   1. DEMO PLAYLIST  (replace src with real URLs / relative paths)
   ───────────────────────────────────────────────────────────── */
const DEMO_PLAYLIST = [
  {
    title: "Campfire Nights",
    artist: "WildFire Sessions",
    album: "Acoustic Vol. 1",
    src: "",           // no real file — player shows as "demo"
    artwork: "https://picsum.photos/seed/fire1/80/80",
    duration: "3:42",
    favourite: false,
  },
  {
    title: "Ember Glow",
    artist: "WildFire Sessions",
    album: "Acoustic Vol. 1",
    src: "",
    artwork: "https://picsum.photos/seed/fire2/80/80",
    duration: "4:15",
    favourite: true,
  },
  {
    title: "Midnight Smoke",
    artist: "Ash & Oak",
    album: "Forest Beats",
    src: "",
    artwork: "https://picsum.photos/seed/fire3/80/80",
    duration: "5:03",
    favourite: false,
  },
  {
    title: "Rising Sparks",
    artist: "Ash & Oak",
    album: "Forest Beats",
    src: "",
    artwork: "https://picsum.photos/seed/fire4/80/80",
    duration: "3:58",
    favourite: false,
  },
];

/* ─────────────────────────────────────────────────────────────
   2. STATE
   ───────────────────────────────────────────────────────────── */
let playlist     = DEMO_PLAYLIST.map(t => ({ ...t }));
let currentIndex = 0;
let isPlaying    = false;
let isMuted      = false;
let isShuffle    = false;
let repeatMode   = "none";   // "none" | "one" | "all"
let volume       = 0.8;
let lastVolume   = 0.8;
let shuffleOrder = [];

/* Audio API objects */
let audioCtx     = null;
let analyser     = null;
let source       = null;
let eqBands      = [];      // BiquadFilterNode[]
let gainNode     = null;
let animFrameId  = null;

/* ─────────────────────────────────────────────────────────────
   3. DOM REFERENCES
   ───────────────────────────────────────────────────────────── */
const audio          = new Audio();
audio.volume         = volume;
audio.crossOrigin    = "anonymous";

const $ = id => document.getElementById(id);

// We defer DOM lookups until DOMContentLoaded
let els = {};

/* ─────────────────────────────────────────────────────────────
   4. INITIALISE
   ───────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  els = {
    player:          document.querySelector(".wfa-player"),
    playBtn:         $("wfa-play-btn"),
    playIcon:        $("wfa-play-icon"),
    prevBtn:         $("wfa-prev-btn"),
    nextBtn:         $("wfa-next-btn"),
    shuffleBtn:      $("wfa-shuffle-btn"),
    repeatBtn:       $("wfa-repeat-btn"),
    progressBar:     $("wfa-progress"),
    currentTimeEl:   $("wfa-current-time"),
    durationEl:      $("wfa-duration"),
    volumeBtn:       $("wfa-volume-btn"),
    volumeIcon:      $("wfa-volume-icon"),
    volumeSlider:    $("wfa-volume-slider"),
    speedSelect:     $("wfa-speed"),
    canvas:          $("wfa-canvas"),
    trackTitle:      $("wfa-track-title"),
    trackArtist:     $("wfa-track-artist"),
    trackAlbum:      $("wfa-track-album"),
    artwork:         $("wfa-artwork"),
    favBtn:          $("wfa-fav-btn"),
    favIcon:         $("wfa-fav-icon"),
    playlistPanel:   $("wfa-playlist-panel"),
    playlistItems:   $("wfa-playlist-items"),
    playlistBtn:     $("wfa-playlist-btn"),
    playlistCount:   $("wfa-playlist-count"),
    eqPanel:         $("wfa-eq-panel"),
    eqBtn:           $("wfa-eq-btn"),
    themeBtn:        $("wfa-theme-btn"),
    uploadBtn:       $("wfa-upload-btn"),
    fileInput:       $("wfa-file-input"),
    shortcutsBtn:    $("wfa-shortcuts-btn"),
    shortcutsModal:  $("wfa-shortcuts-modal"),
    shortcutsClose:  $("wfa-shortcuts-close"),
    toast:           $("wfa-toast"),
  };

  buildPlaylist();
  loadTrack(currentIndex, false);
  setupEventListeners();
  setupKeyboardShortcuts();
  setupDragAndDrop();
  setupEqualizer();
  updateVolumeSlider();
  syncRepeatIcon();
  updatePlaylistCount();

  // Initialise canvas dimensions and watch for resize
  initCanvasDimensions();
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => initCanvasDimensions()).observe(els.canvas);
  }
});

/* ─────────────────────────────────────────────────────────────
   5. TRACK LOADING
   ───────────────────────────────────────────────────────────── */
function loadTrack(index, autoPlay = false) {
  if (index < 0 || index >= playlist.length) return;
  currentIndex = index;
  const track  = playlist[currentIndex];

  audio.src    = track.src || "";
  audio.load();

  els.trackTitle.textContent  = track.title;
  els.trackArtist.textContent = track.artist;
  els.trackAlbum.textContent  = track.album || "";

  els.artwork.src = track.artwork || "https://via.placeholder.com/80";
  els.artwork.alt = `${track.title} artwork`;

  // favourite
  updateFavIcon();

  // duration label from metadata or static string
  if (track.duration) {
    els.durationEl.textContent = track.duration;
  } else {
    els.durationEl.textContent = "0:00";
  }

  els.progressBar.value = 0;
  setRangeFill(els.progressBar, 0);
  els.currentTimeEl.textContent = "0:00";

  highlightPlaylistItem();

  if (autoPlay) {
    playAudio();
  } else {
    setPaused();
  }
}

/* ─────────────────────────────────────────────────────────────
   6. PLAYBACK CONTROL
   ───────────────────────────────────────────────────────────── */
function playAudio() {
  if (!audio.src) {
    showToast("No audio source — drag & drop an audio file!");
    return;
  }
  const promise = audio.play();
  if (promise !== undefined) {
    promise
      .then(() => setPlaying())
      .catch(err => {
        // Only treat NotAllowedError (autoplay policy) as soft — keep playing state.
        // For genuine failures (e.g. unsupported format) fall back to paused state.
        if (err.name === "NotAllowedError") {
          setPlaying();
        } else {
          setPaused();
          showToast("Playback failed — check the audio source");
        }
      });
  }
  initAudioContext();
  startVisualizer();
}

function pauseAudio() {
  audio.pause();
  setPaused();
  stopVisualizer();
}

function togglePlay() {
  if (isPlaying) {
    pauseAudio();
  } else {
    playAudio();
  }
}

function setPlaying() {
  isPlaying = true;
  els.playIcon.textContent = "⏸";
  els.playBtn.setAttribute("aria-label", "Pause");
  updatePlaylistAnimBars(true);
}

function setPaused() {
  isPlaying = false;
  els.playIcon.textContent = "▶";
  els.playBtn.setAttribute("aria-label", "Play");
  updatePlaylistAnimBars(false);
}

function prevTrack() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const nextIdx = getPrevIndex();
  loadTrack(nextIdx, isPlaying);
}

function nextTrack() {
  const nextIdx = getNextIndex();
  if (nextIdx === -1) {
    // end of playlist, no repeat
    pauseAudio();
    return;
  }
  loadTrack(nextIdx, isPlaying);
}

function getPrevIndex() {
  if (isShuffle && shuffleOrder.length > 1) {
    const pos = shuffleOrder.indexOf(currentIndex);
    return shuffleOrder[pos > 0 ? pos - 1 : shuffleOrder.length - 1];
  }
  return currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;
}

function getNextIndex() {
  if (repeatMode === "one") return currentIndex;
  if (isShuffle) {
    const pos  = shuffleOrder.indexOf(currentIndex);
    const next = pos + 1 < shuffleOrder.length ? pos + 1 : 0;
    if (pos + 1 >= shuffleOrder.length && repeatMode === "none") return -1;
    return shuffleOrder[next];
  }
  if (currentIndex + 1 < playlist.length) return currentIndex + 1;
  if (repeatMode === "all") return 0;
  return -1;
}

/* ─────────────────────────────────────────────────────────────
   7. SHUFFLE & REPEAT
   ───────────────────────────────────────────────────────────── */
function toggleShuffle() {
  isShuffle = !isShuffle;
  els.shuffleBtn.classList.toggle("active", isShuffle);
  if (isShuffle) {
    buildShuffleOrder();
    showToast("Shuffle on");
  } else {
    showToast("Shuffle off");
  }
}

function buildShuffleOrder() {
  // Fisher-Yates shuffle for uniform randomness
  const indices = [...playlist.keys()].filter(i => i !== currentIndex);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  shuffleOrder = [currentIndex, ...indices];
}

function toggleRepeat() {
  const modes = ["none", "one", "all"];
  const idx   = modes.indexOf(repeatMode);
  repeatMode  = modes[(idx + 1) % modes.length];
  syncRepeatIcon();
  const labels = { none: "Repeat off", one: "Repeat one", all: "Repeat all" };
  showToast(labels[repeatMode]);
}

function syncRepeatIcon() {
  const icon = $("wfa-repeat-icon");
  if (repeatMode === "one") {
    icon.textContent = "🔂";
    els.repeatBtn.classList.add("active");
  } else if (repeatMode === "all") {
    icon.textContent = "🔁";
    els.repeatBtn.classList.add("active");
  } else {
    icon.textContent = "🔁";
    els.repeatBtn.classList.remove("active");
  }
}

/* ─────────────────────────────────────────────────────────────
   8. VOLUME & MUTE
   ───────────────────────────────────────────────────────────── */
function setVolume(val) {
  volume       = Math.max(0, Math.min(1, val));
  audio.volume = isMuted ? 0 : volume;
  if (gainNode) gainNode.gain.value = isMuted ? 0 : volume;
  setRangeFill(els.volumeSlider, volume * 100);
  updateVolumeIcon();
}

function toggleMute() {
  isMuted = !isMuted;
  if (isMuted) {
    lastVolume   = volume;
    audio.volume = 0;
    if (gainNode) gainNode.gain.value = 0;
    els.volumeSlider.value = 0;
    setRangeFill(els.volumeSlider, 0);
  } else {
    volume       = lastVolume;
    audio.volume = volume;
    if (gainNode) gainNode.gain.value = volume;
    els.volumeSlider.value = volume * 100;
    setRangeFill(els.volumeSlider, volume * 100);
  }
  updateVolumeIcon();
}

function updateVolumeSlider() {
  els.volumeSlider.value = volume * 100;
  setRangeFill(els.volumeSlider, volume * 100);
  updateVolumeIcon();
}

function updateVolumeIcon() {
  const v = isMuted || volume === 0 ? 0 : volume;
  els.volumeIcon.textContent = v === 0 ? "🔇" : v < 0.4 ? "🔈" : v < 0.7 ? "🔉" : "🔊";
}

/* ─────────────────────────────────────────────────────────────
   9. PROGRESS / SEEK
   ───────────────────────────────────────────────────────────── */
function formatTime(s) {
  if (!isFinite(s) || isNaN(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${sec}`;
}

function setRangeFill(rangeEl, pct) {
  rangeEl.style.backgroundSize = `${pct}% 100%`;
}

/* ─────────────────────────────────────────────────────────────
   10. FAVOURITES
   ───────────────────────────────────────────────────────────── */
function toggleFavourite() {
  playlist[currentIndex].favourite = !playlist[currentIndex].favourite;
  updateFavIcon();
  showToast(playlist[currentIndex].favourite ? "Added to favourites ♥" : "Removed from favourites");
}

function updateFavIcon() {
  const fav = playlist[currentIndex].favourite;
  els.favIcon.textContent = fav ? "♥" : "♡";
  els.favBtn.classList.toggle("active", fav);
  els.favBtn.setAttribute("aria-label", fav ? "Remove from favourites" : "Add to favourites");
}

/* ─────────────────────────────────────────────────────────────
   11. PLAYLIST UI
   ───────────────────────────────────────────────────────────── */
function buildPlaylist() {
  els.playlistItems.innerHTML = "";
  playlist.forEach((track, i) => {
    const item = document.createElement("div");
    item.className = "wfa-playlist-item" + (i === currentIndex ? " active" : "");
    item.dataset.index = i;
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-label", `Play ${track.title} by ${track.artist}`);
    item.innerHTML = `
      <span class="wfa-pl-num">${i + 1}</span>
      <img class="wfa-pl-art" src="${track.artwork || 'https://via.placeholder.com/36'}" alt="" loading="lazy">
      <div class="wfa-pl-info">
        <div class="wfa-pl-title">${escapeHtml(track.title)}</div>
        <div class="wfa-pl-artist">${escapeHtml(track.artist)}</div>
      </div>
      <span class="wfa-pl-duration">${track.duration || ""}</span>
      <span class="wfa-pl-playing-indicator" aria-hidden="true">
        <span class="wfa-pl-bar"></span>
        <span class="wfa-pl-bar"></span>
        <span class="wfa-pl-bar"></span>
      </span>
    `;
    item.addEventListener("click", () => {
      loadTrack(i, true);
    });
    item.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        loadTrack(i, true);
      }
    });
    els.playlistItems.appendChild(item);
  });
  highlightPlaylistItem();
  updatePlaylistCount();
}

function highlightPlaylistItem() {
  const items = els.playlistItems.querySelectorAll(".wfa-playlist-item");
  items.forEach((el, i) => {
    el.classList.toggle("active", i === currentIndex);
  });
  // scroll active item into view
  const active = els.playlistItems.querySelector(".wfa-playlist-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

function updatePlaylistAnimBars(playing) {
  const bars = els.playlistItems.querySelectorAll(".wfa-playlist-item.active .wfa-pl-bar");
  bars.forEach(b => b.classList.toggle("paused", !playing));
}

function updatePlaylistCount() {
  els.playlistCount.textContent = `${playlist.length} track${playlist.length !== 1 ? "s" : ""}`;
}

function togglePlaylist() {
  els.playlistPanel.classList.toggle("visible");
  els.playlistBtn.classList.toggle("active", els.playlistPanel.classList.contains("visible"));
}

/* ─────────────────────────────────────────────────────────────
   12. EQUALIZER  (Web Audio API)
   ───────────────────────────────────────────────────────────── */
const EQ_FREQS   = [60, 250, 1000, 4000, 12000]; // Hz
const EQ_LABELS  = ["60Hz", "250Hz", "1kHz", "4kHz", "12kHz"];

function setupEqualizer() {
  const container = $("wfa-eq-bands");
  EQ_FREQS.forEach((freq, i) => {
    const band = document.createElement("div");
    band.className = "wfa-eq-band";
    band.innerHTML = `
      <label for="wfa-eq-${i}" style="font-size:0.6rem;color:var(--wfa-text-muted)">${EQ_LABELS[i]}</label>
      <input type="range" id="wfa-eq-${i}" min="-15" max="15" value="0"
             aria-label="${EQ_LABELS[i]} equalizer band"
             data-band="${i}">
      <span id="wfa-eq-val-${i}" style="font-size:0.6rem">0 dB</span>
    `;
    container.appendChild(band);
    band.querySelector("input").addEventListener("input", onEqChange);
  });
}

function onEqChange(e) {
  const i   = parseInt(e.target.dataset.band, 10);
  const val = parseFloat(e.target.value);
  $(`wfa-eq-val-${i}`).textContent = `${val > 0 ? "+" : ""}${val} dB`;
  if (eqBands[i]) {
    eqBands[i].gain.value = val;
  }
}

function initAudioContext() {
  if (audioCtx) return;
  audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
  analyser  = audioCtx.createAnalyser();
  gainNode  = audioCtx.createGain();
  gainNode.gain.value = volume;

  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  // Create EQ filter chain
  eqBands = EQ_FREQS.map((freq, i) => {
    const filter = audioCtx.createBiquadFilter();
    filter.type  = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
    filter.frequency.value = freq;
    filter.gain.value = 0;
    return filter;
  });

  // Chain: source → eq[0] → ... → eq[n] → gain → analyser → destination
  source = audioCtx.createMediaElementSource(audio);
  let node = source;
  eqBands.forEach(f => { node.connect(f); node = f; });
  node.connect(gainNode);
  gainNode.connect(analyser);
  analyser.connect(audioCtx.destination);

  // Restore any EQ values already set in the UI
  EQ_FREQS.forEach((_, i) => {
    const input = $(`wfa-eq-${i}`);
    if (input && eqBands[i]) {
      eqBands[i].gain.value = parseFloat(input.value);
    }
  });
}

function toggleEq() {
  els.eqPanel.classList.toggle("visible");
  els.eqBtn.classList.toggle("active", els.eqPanel.classList.contains("visible"));
}

/* ─────────────────────────────────────────────────────────────
   13. VISUALIZER  (Canvas)
   ───────────────────────────────────────────────────────────── */
function startVisualizer() {
  stopIdleAnimation();
  if (animFrameId) return;
  drawVisualizer();
}

function stopVisualizer() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  clearCanvas();
  startIdleAnimation();
}

/* Cached canvas dimensions — updated by ResizeObserver */
let canvasW = 0;
let canvasH = 0;

function initCanvasDimensions() {
  const canvas = els.canvas;
  if (!canvas) return;
  const dpr  = window.devicePixelRatio || 1;
  canvasW    = canvas.offsetWidth  * dpr;
  canvasH    = canvas.offsetHeight * dpr;
  canvas.width  = canvasW;
  canvas.height = canvasH;
}

function clearCanvas() {
  const canvas = els.canvas;
  if (!canvas) return;
  const ctx    = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvasW, canvasH);
}

function drawVisualizer() {
  const canvas = els.canvas;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const W   = canvasW;
  const H   = canvasH;

  ctx.clearRect(0, 0, W, H);

  if (!analyser) {
    // draw idle bars
    drawIdleBars(ctx, W, H);
    animFrameId = requestAnimationFrame(drawVisualizer);
    return;
  }

  const bufferLen = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLen);
  analyser.getByteFrequencyData(dataArray);

  const barW   = (W / bufferLen) * 2.5;
  let   xPos   = 0;

  const accent = getComputedStyle(document.documentElement)
                   .getPropertyValue("--wfa-vis-bar").trim() || "#e94560";

  for (let i = 0; i < bufferLen; i++) {
    const barH = (dataArray[i] / 255) * H;
    const alpha = 0.6 + (dataArray[i] / 255) * 0.4;
    ctx.fillStyle = hexToRgba(accent, alpha);
    ctx.fillRect(xPos, H - barH, barW - 1, barH);
    xPos += barW;
    if (xPos > W) break;
  }

  animFrameId = requestAnimationFrame(drawVisualizer);
}

function drawIdleBars(ctx, W, H) {
  const count  = 40;
  const barW   = (W / count) - 1;
  const accent = getComputedStyle(document.documentElement)
                   .getPropertyValue("--wfa-vis-bar").trim() || "#e94560";

  for (let i = 0; i < count; i++) {
    const h     = (Math.sin(Date.now() / 400 + i * 0.4) * 0.5 + 0.5) * H * 0.4 + 4;
    ctx.fillStyle = hexToRgba(accent, 0.25);
    ctx.fillRect(i * (barW + 1), H - h, barW, h);
  }
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace(/\s/g, "");
  const m     = clean.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return `rgba(233,69,96,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

/* ─────────────────────────────────────────────────────────────
   14. THEME TOGGLE
   ───────────────────────────────────────────────────────────── */
function toggleTheme() {
  const body     = document.documentElement;
  const isDark   = body.getAttribute("data-theme") !== "light";
  body.setAttribute("data-theme", isDark ? "light" : "dark");
  $("wfa-theme-icon").textContent = isDark ? "🌙" : "☀️";
  showToast(isDark ? "Light theme" : "Dark theme");
}

/* ─────────────────────────────────────────────────────────────
   15. FILE UPLOAD / DRAG & DROP
   ───────────────────────────────────────────────────────────── */
function handleFiles(files) {
  const audioFiles = [...files].filter(f => f.type.startsWith("audio/"));
  if (!audioFiles.length) {
    showToast("No audio files found");
    return;
  }
  const newTracks = audioFiles.map(f => ({
    title:     f.name.replace(/\.[^.]+$/, ""),
    artist:    "Local File",
    album:     "",
    src:       URL.createObjectURL(f),
    artwork:   "https://picsum.photos/seed/" + encodeURIComponent(f.name) + "/80/80",
    duration:  "",
    favourite: false,
  }));
  playlist = [...playlist, ...newTracks];
  buildPlaylist();
  loadTrack(playlist.length - newTracks.length, true);
  showToast(`Added ${newTracks.length} track${newTracks.length > 1 ? "s" : ""}`);
}

function setupDragAndDrop() {
  const player = els.player;

  player.addEventListener("dragover", e => {
    e.preventDefault();
    player.classList.add("drag-over");
  });

  player.addEventListener("dragleave", e => {
    if (!player.contains(e.relatedTarget)) {
      player.classList.remove("drag-over");
    }
  });

  player.addEventListener("drop", e => {
    e.preventDefault();
    player.classList.remove("drag-over");
    handleFiles(e.dataTransfer.files);
  });

  els.fileInput.addEventListener("change", e => {
    handleFiles(e.target.files);
    e.target.value = "";
  });
}

/* ─────────────────────────────────────────────────────────────
   16. KEYBOARD SHORTCUTS
   ───────────────────────────────────────────────────────────── */
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", e => {
    // Ignore if typing in an input / select
    if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        e.preventDefault();
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
        showToast("+5s");
        break;
      case "ArrowLeft":
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - 5);
        showToast("-5s");
        break;
      case "ArrowUp":
        e.preventDefault();
        setVolume(volume + 0.05);
        els.volumeSlider.value = volume * 100;
        showToast(`Volume ${Math.round(volume * 100)}%`);
        break;
      case "ArrowDown":
        e.preventDefault();
        setVolume(volume - 0.05);
        els.volumeSlider.value = volume * 100;
        showToast(`Volume ${Math.round(volume * 100)}%`);
        break;
      case "n":
      case "N":
        nextTrack();
        break;
      case "p":
      case "P":
        prevTrack();
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "s":
      case "S":
        toggleShuffle();
        break;
      case "r":
      case "R":
        toggleRepeat();
        break;
      case "?":
        els.shortcutsModal.classList.toggle("visible");
        break;
      case "Escape":
        els.shortcutsModal.classList.remove("visible");
        break;
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   17. EVENT LISTENERS
   ───────────────────────────────────────────────────────────── */
function setupEventListeners() {
  // Playback buttons
  els.playBtn.addEventListener("click",    togglePlay);
  els.prevBtn.addEventListener("click",    prevTrack);
  els.nextBtn.addEventListener("click",    nextTrack);
  els.shuffleBtn.addEventListener("click", toggleShuffle);
  els.repeatBtn.addEventListener("click",  toggleRepeat);

  // Progress seek
  els.progressBar.addEventListener("input", e => {
    const pct = parseFloat(e.target.value);
    setRangeFill(els.progressBar, pct);
    if (audio.duration) {
      audio.currentTime = (pct / 100) * audio.duration;
    }
  });

  // Volume
  els.volumeSlider.addEventListener("input", e => {
    isMuted = false;
    setVolume(parseFloat(e.target.value) / 100);
  });
  els.volumeBtn.addEventListener("click", toggleMute);

  // Speed
  els.speedSelect.addEventListener("change", e => {
    audio.playbackRate = parseFloat(e.target.value);
    showToast(`Speed ${e.target.value}×`);
  });

  // Favourite
  els.favBtn.addEventListener("click", toggleFavourite);

  // Playlist toggle
  els.playlistBtn.addEventListener("click", togglePlaylist);

  // EQ toggle
  els.eqBtn.addEventListener("click", toggleEq);

  // Theme toggle
  els.themeBtn.addEventListener("click", toggleTheme);

  // Upload
  els.uploadBtn.addEventListener("click", () => els.fileInput.click());

  // Shortcuts modal
  els.shortcutsBtn.addEventListener("click", () => els.shortcutsModal.classList.add("visible"));
  els.shortcutsClose.addEventListener("click", () => els.shortcutsModal.classList.remove("visible"));
  els.shortcutsModal.addEventListener("click", e => {
    if (e.target === els.shortcutsModal) els.shortcutsModal.classList.remove("visible");
  });

  // Audio events
  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    els.progressBar.value = pct;
    setRangeFill(els.progressBar, pct);
    els.currentTimeEl.textContent = formatTime(audio.currentTime);
  });

  audio.addEventListener("loadedmetadata", () => {
    els.durationEl.textContent = formatTime(audio.duration);
  });

  audio.addEventListener("ended", () => {
    nextTrack();
  });

  audio.addEventListener("error", () => {
    setPaused();
  });

  audio.addEventListener("play",  setPlaying);
  audio.addEventListener("pause", setPaused);

  // Idle visualizer loop (no audio context)
  startIdleAnimation();
}

/* ─────────────────────────────────────────────────────────────
   18. IDLE VISUALIZER  (before any audio loads)
   ───────────────────────────────────────────────────────────── */
let idleAnimId = null;

function startIdleAnimation() {
  if (idleAnimId) return;
  function loop() {
    const canvas = els.canvas;
    if (canvas && !isPlaying) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvasW, canvasH);
      drawIdleBars(ctx, canvasW, canvasH);
    }
    idleAnimId = requestAnimationFrame(loop);
  }
  idleAnimId = requestAnimationFrame(loop);
}

function stopIdleAnimation() {
  if (idleAnimId) {
    cancelAnimationFrame(idleAnimId);
    idleAnimId = null;
  }
}

/* ─────────────────────────────────────────────────────────────
   19. TOAST
   ───────────────────────────────────────────────────────────── */
let toastTimer = null;

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2000);
}

/* ─────────────────────────────────────────────────────────────
   20. UTILITIES
   ───────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
