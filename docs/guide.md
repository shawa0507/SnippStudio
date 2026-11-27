# SnippStudio user guide

[Türkçe](kullanim.md) · [Working with an agent](agents.md)

SnippStudio is a video editor for Windows that also lets an AI agent you already use work on your project. Everything here runs on your computer: your media is not uploaded anywhere, and the app itself never goes online.

The interface is in English by default. **File → Language → Türkçe** switches it to Turkish; the choice is kept.

## A five-minute tour

The first time the app opens, a short tour points at the five parts of the window. It does not block anything: you can work while it is open, press **Skip** on any step, or **Esc**. **File → Help → Show the tour** brings it back.

To try everything without your own footage, use **File → Help → Open the sample project** (or the card of the same name in **File → Projects…**). The app makes a small project of its own each time, as a new copy: three coloured test clips with a tone, a title, a template on the G lane and a code clip. Change it freely; the next sample is a fresh copy again.

1. **Bring your media.** **Import** in the media panel (left), or drop files and whole folders onto the window. Videos, pictures and sound are all accepted. A dropped folder stays one item you can open.
2. **The timeline.** Click **+** on a file to add it at the end of the timeline, or drag it where you want it. **S** splits at the playhead, dragging a clip's edge trims it, dragging a clip moves it. **Ctrl+Z** undoes.
3. **The preview** plays the timeline as it will be exported. **Space** plays and pauses.
4. **Agent access** (the switch in the top bar) lets an AI agent you already use work on the project. Add the agent once in **Settings → Agent connection** (the gear in the top bar): for Claude Code, run its command once in your own terminal, and from then on every Claude Code chat sees the tools while SnippStudio is open and access is on (see [Working with an agent](agents.md)). You give the agent its work in its own chat, or send it from here: write it in the **command box** under the Inspector and press **Send**, or **Send to agent** on the Notes tab; while the agent waits (its `wait` tool) it gets it in its chat at once. The box also holds the app's own ready jobs (cut silences, subtitles, even out the loudness…), done here.
5. **Export** (top right) writes the video.

## How the work goes

### Media and the timeline
- The left panel is a column of categories, the chosen one's page beside it: **Media** (your files), **Audio** (your sound effect library), **Text** (the templates), **Captions** (subtitles from the speech; it opens the Subs tab), **Effects** (motion for many clips, shapes), **Transitions** (drag one onto a cut, or put one on every cut), **Filters** (the looks for the selected clip) and **Code** (code films and code templates). A slider moves by its step; hold **Shift** for ten steps, **Alt** for a tenth.
- Tracks: **V** lanes are pictures, **A** lanes are sound, the **Notes** lane holds work notes, the **G** lane holds templates. Linked picture and sound move together.
- Tools in the timeline's toolbar: selection, split, slip, the cutter (mark ranges to cut), snapping. Their keys are in the table below.
- **Close gaps automatically** (a button in each track's header) keeps that track's clips joined when one is removed or trimmed; off, the others stay where they are.
- Transitions: point at a cut and click its **+**, or **Ctrl+T** for the default transition at the nearest cut. The Inspector's **Clip** tab then shows the transition's kind and length.
- Markers, in and out points (**I**, **O**) and a loop of the marked range (**Ctrl+L**).

### The Inspector (right)
- **Clip**: everything about the selected clip, in cards that fold (each remembers whether it is open): **Transform** (scale, position X and Y on one row — drag the X or Y to change it — rotation, **Center**, **Fill**, **Fit**, flip, rotate 90°; its diamond keys them all at the playhead); **Audio** (its small tabs: level and loudness, voice cleaning, fades, EQ and compressor; the switch at its right mutes the clip); **Speed** (one speed or a curve, freeze frame, reverse); **Opacity and blend**; **Color and LUT** (with LUT files, .cube); **Effects** (a look such as Retro TV or VHS tape, light on a still picture, an ambient frame, sharpen, grain, vignette); **Mask**; **Crop**; **Green screen**; **Tracking** (following a motion tracker); **Animation** (entrance, exit and motion while visible); cinematic motion; picture moves; **Keyframes** (**Alt+K** at the playhead); the transition after it.
- **Look**: what goes over many clips at once. **Camera look** (Film, Super 8, grain, vignette, cinema bars…) is a layer on the timeline: pick one and it is placed at the playhead, then trim and move it like a clip. The **Living frame**, light on stills, ambient frames and speed-ramp entrances go on the selected clips or on every clip. **Scopes** show the picture's levels.
- **Subs**: subtitles. **Generate subtitles** makes them from the speech with a model that runs on this computer; choose the spoken language for reliable word timing (a new project starts with the interface's language). SRT files can be imported and exported; the words can be animated.
- **Template**: the selected template of the G lane (its kind, items, look).
- **Notes**: your work notes (below).
- **Project**: **Sound** (automatic music ducking, transition sounds), **Script** (the transcript: select words to cut them, mark ranges), **Settings** (name, resolution, frame rate, background, project look, preview snapping, render queue, chapters, archive).

### Text-based editing, silences and fillers
- **Project → Script** shows what is said. Selecting words and cutting them cuts the timeline at the same moments.
- The preview's toolbar has **Cut silence**: it finds the pauses; you choose which ones go.

### Templates and code clips
- **Text** has 31 ready graphics for the G lane (lists, charts, maps, a chess board, a video player…). Hover a card to see it move; **Insert at playhead** puts it there.
- **Code clips** are web pages drawn live over the video: a folder with an `index.html` (and, if there is one, the sound in `audio/mix.wav`). Add one with **Add a code film** on the left panel's **Code** page, or one of the six code templates there. A code clip's parameters are set in the Inspector; **Edit values** opens its numbers and colours. When an agent creates a code clip on an unsaved project, it gives the project a `.snipp` file in Documents first.

### Work notes
- **N** puts a note at the playhead; **Shift + drag** on the Notes lane marks a stretch; a double click there is a note at that moment. A note can carry a drawing on the preview.
- With an agent connected, **Send to agent** hands the open notes over; its answers come back on the notes for you to approve.

### Saving
- **Ctrl+S** saves; a new project asks for a name once. Projects are `.snipp` files; media files stay where they are and are found by their paths.
- The app saves a crash-recovery snapshot while there are unsaved changes and offers it after a crash.
- **File → Earlier versions…** keeps the last five copies of the file as it was before a save wrote over it.
- **File → Archive project…** copies the project with all its media into one folder.
- **File → Projects…** lists your projects (search, sort, find projects in folders).

## Exporting

**Export** (or **File → Video or sound…**) opens the export window.

- **Presets**: YouTube 1080p, YouTube 4K, Shorts / Reels (a vertical project), Custom.
- **Format**: MP4 (H.264), WebM (VP9), or sound only: MP3, M4A (AAC), WAV.
- **Size**: the project's size, smaller for speed, or larger up to 4K. **Frame rate** and **Quality**.
- **Range**: the whole timeline or the in / out points.
- **Loudness**: normalize to a target (YouTube's −14 LUFS by default for its presets).
- **Encoder**: automatic (the graphics card's encoder when it takes the choice, else the software one) or software.
- The export window shows progress and the time left; **Renders** in the top bar lists the exports.
- Other exports in the File menu: subtitles (.srt), SRT + word SRT + MP3 for a voice set, the current frame as PNG. Shorts segments export from the Shorts panel.

## Keyboard shortcuts

The keys of every action, as they are when the app is installed. **Settings → Keyboard shortcuts** (also **File → Help → Keyboard shortcuts**) shows them in the app, where each one can be changed, or a ready set (Premiere Pro style, CapCut style) chosen at once.

<!-- shortcuts:start -->
| Action | Key |
|---|---|
| Play / Pause | `Space` |
| Delete selection / cut region | `Backspace` |
| Split at playhead | `S` |
| Split tool (click a clip to split there) | `B` |
| Slip tool (drag a clip to slide its footage) | `Y` |
| Toggle cutter tool | `C` |
| Selection tool | `A` |
| Select everything on the timeline | `Ctrl + A` |
| Undo | `Ctrl + Z` |
| Redo | `Ctrl + Shift + Z` |
| Save project | `Ctrl + S` |
| Go to start | `Home` |
| Step back one frame | `Left` |
| Step forward one frame | `Right` |
| Jump back 1 second | `Shift + Left` |
| Jump forward 1 second | `Shift + Right` |
| Nudge selected clips left 1 frame | `Alt + Left` |
| Nudge selected clips right 1 frame | `Alt + Right` |
| In point: the export range (in Shorts mode, the Short segment) | `I` |
| Out point: the export range (in Shorts mode, the Short segment) | `O` |
| Zoom to fit whole project | `Shift + Z` |
| Zoom to selected clips | `Z` |
| Jump to previous edit point | `Up` |
| Jump to next edit point | `Down` |
| Loop the marked range | `Ctrl + L` |
| Jump to next marker | `Shift + M` |
| Jump to previous marker | `Ctrl + Shift + M` |
| Disable / enable selected clips | `D` |
| Work note at the playhead | `N` |
| Previous keyframe | `Alt + ,` |
| Next keyframe | `Alt + .` |
| Add or remove a keyframe at the playhead | `Alt + K` |
| Add the default transition at the nearest cut | `Ctrl + T` |
| Split target clip at playhead | `Ctrl + B` |
| Delete the clip left of the playhead (its track closes up; Alt: every track) | `Q` |
| Delete the clip right of the playhead (its track closes up; Alt: every track) | `W` |
| Close gap at playhead | `E` |
| Shuttle rewind (J) | `J` |
| Shuttle pause (K) | `K` |
| Shuttle forward (L) | `L` |
| Open the settings | `Ctrl + ,` |
| Go to a time or frame | `G` |
| Play slower | `[` |
| Play faster | `]` |
| Preview at 100 % (one pixel per pixel) | `1` |
| Fit the preview | `0` |
| Previous work note | `,` |
| Next work note | `.` |
| Narration line under the preview | `Shift + C` |
| Shortcut list over the preview | `?` |
| In a review: before / after | `B` |
| In a review: approve | `Y` |
| Note on the preview: click, pin, type | `Shift + N` |
| Watch and note mode | `Shift + R` |
<!-- shortcuts:end -->

## Known limits

- **Windows only** in this release; macOS and Linux builds are not made yet.
- The installer is **not signed**: Windows SmartScreen warns before it runs.
- **No automatic updates**: the app does not check for new versions (it does not go online).
- Subtitles come from one speech model that runs on this computer (several languages; Turkish and English are the ones tested). It runs on the processor: a ten-minute talk took about eight minutes on a six-core desktop processor.
- HDR footage is exported in standard range (SDR).
- A code clip's page runs without network access.
- The Turkish interface has not been reviewed by a professional translator.
