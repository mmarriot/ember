# Getting started

From nothing to an event on screen, and to a link you can send. Three starting points, shortest first:

1. [look at the shared samples](#1-look-at-the-shared-samples): nothing to run;
2. [your own events from a new reconstruction job](#2-your-own-events-from-a-new-reconstruction-job): one more step
   in your `cmsDriver.py` command, then one command;
3. [a step3.root you already have](#3-a-step3root-you-already-have): one command.

Then [five things to try first](#4-five-things-to-try-first) in the viewer, [sharing a link](#5-share-a-link),
[your files on the site](#6-your-files) and [keeping a file to yourself](#7-keep-it-to-yourself).

> **The site's address is provisional.** This page writes `https://cms-evd.web.cern.ch` and
> `/eos/project/c/cms-evd/` for the CMS site. It is not set up yet; the names may change when it is.
> [What works today](#what-works-today) says what you can do before then.

## Before you start

- **To look:** a browser and a CERN account that is a member of CMS (the site is behind the CERN sign-on).
- **For your own events:** a CMSSW area with the event-display NanoAOD (the `NANO:@EVD` flavour, Phase-2 full
  simulation; see [CMSSW side](cmssw.md)), and the `evd` command.

> **Until the CMSSW pull requests are merged** (delete this box afterwards). `NANO:@EVD` is not in a release yet. In
> your CMSSW area (CMSSW_20_1_X), once:
>
> ```bash
> git cms-merge-topic mmarriot:eventdisplay-nano
> scram b -j 8
> ```
>
> Everything else on this page is the same.

### The `evd` command

`evd` is one file that runs in any CMSSW environment (it needs `python3` with numpy and uproot, which `cmsenv`
provides) with nothing to install. Any of:

```bash
# on lxplus: the copy kept next to the site (provisional path)
alias evd=/eos/project/c/cms-evd/bin/evd

# anywhere: build the one file from a clone
git clone https://github.com/mmarriot/evd.git
python3 evd/tools/build_zipapp.py ~/bin/evd        # then ~/bin/evd, or put ~/bin in PATH

# or install it with pip (outside CMSSW, or in a virtual environment)
python3 -m pip install git+https://github.com/mmarriot/evd.git
```

`evd --version` prints `evd 0.2.0`. Every command and option is in [The `evd` command](cli.md).

## 1. Look at the shared samples

Open the site, `https://cms-evd.web.cern.ch` (provisional). It opens the newest shared data set. The button at the
left of the top bar names the data set that is open; click it to choose another:

- the site's **shared groups**: a few events of each RelVal sample of recent releases, and test-stand data, kept
  current by the site (see [Hosting](hosting.md));
- **My files** and **Recent**, which are empty until you publish something or open someone's link.

Type in the panel to filter, ↑ ↓ and Enter to open, Esc to close. Go on to
[five things to try first](#4-five-things-to-try-first).

## 2. Your own events from a new reconstruction job

Add the `NANO:@EVD` step, a NanoAOD event content and a NanoAOD data tier to the `cmsDriver.py` command you already
use for step3:

```bash
cmsDriver.py step3 -s RAW2DIGI,RECO,RECOSIM,NANO:@EVD \
    --conditions auto:phase2_realistic_T35 --geometry ExtendedRun4D104 --era Phase2C22I13M9 \
    --eventcontent FEVTDEBUGHLT,NANOAODSIM --datatier GEN-SIM-RECO,NANOAODSIM \
    --filein file:step2.root --fileout file:step3.root -n -1 --nThreads 16
```

Only `NANO:@EVD`, `NANOAODSIM` (twice) are new; keep your own conditions, geometry, era and everything else. The job
writes `step3.root` as before and, beside it, `step3_inNANOAODSIM.root`: the same events as tables. The step runs
nothing unless it is asked for, and on a 20-event ttbar job without pile-up it changed neither the job's wall time
nor its memory measurably ([costs](cmssw.md#what-it-costs)).

Then:

```
$ evd step3_inNANOAODSIM.root
step3_inNANOAODSIM.root: NanoAOD from CMSSW_20_1_X_2026-11-12-2300, 20 events
  44 tables, 86 relations, 43 display layers
  10 events of 20 (--max-events 0 for all), 8 MB, 1 s
published step3_inNANOAODSIM: kept until 2026-12-13 (evd list, evd rm step3_inNANOAODSIM)

https://cms-evd.web.cern.ch/#b=data/u/jsmith/step3_inNANOAODSIM.evdb
```

The last line is the link: open it, or send it. What happened: `evd` read the tables, wrote the first 10 events as a
bundle (`.evdb`), copied it to your area of the site, `data/u/<your login>/`, and added it to your list there.

Useful options (all of them: [cli.md](cli.md#evd-view)):

| | |
|---|---|
| `--max-events 50`, `--max-events 0` | more events, or all of them (10 by default: a PU200 event is about 18 MB to download) |
| `--events 3,7-9` | these event numbers only |
| `--name ttbar_newtune --title "ttbar, new tune"` | the name in the link and the title in the viewer's list (default: the file's name) |
| `-o mine.evdb` | write the bundle here and publish nothing ([keep it to yourself](#7-keep-it-to-yourself)) |

Off lxplus, where `/eos` is not mounted, `evd` copies through XRootD and needs a Kerberos ticket:
`kinit <login>@CERN.CH`.

## 3. A step3.root you already have

```bash
cmsenv          # in a release that has NANO:@EVD
evd step3.root
```

For a CMSSW reconstruction file `evd` first makes the NanoAOD itself, with `cmsDriver.py ... -s NANO:@EVD` in a
temporary directory, then goes on as above. It says what it found:

- the **geometry**, read from the file (the list of geometry files its job used, matched to the release's Run4
  geometries);
- the **conditions**: the file's global tag if it names exactly one, else the release's default for that geometry;
- the **era**: the release's default for that geometry. A file does not record its era.

When it cannot tell, or the file was made with something else than the defaults, say it:

```bash
evd step3.root --geometry D110 --era Phase2C17I13M9 --conditions auto:phase2_realistic_T33
evd step3.root --nano evd_nano.root        # also keep the NanoAOD that was made
```

What the file must hold: the event content `FEVTDEBUGHLT`, which is what RelVal `GEN-SIM-RECO` files are written
with, or `RECOSIM`. `AODSIM` and MiniAOD lack the hits and are not supported. The same thing by hand, if you want the NanoAOD as a file of its own:

```bash
cmsDriver.py evd -s NANO:@EVD --conditions auto:phase2_realistic_T35 --geometry ExtendedRun4D104 \
    --era Phase2C22I13M9 --mc --eventcontent NANOAODSIM --datatier NANOAODSIM -n -1 --nThreads 8 \
    --filein file:step3.root --fileout file:evd_nano.root
evd evd_nano.root
```

This takes about 0.3 s per event without pile-up and 1.6 s per event at 200 pile-up (8 threads), plus about 20 s
for the job to start.

## 4. Five things to try first

The viewer's own help is `?`; everything is described in [Viewer](viewer.md).

1. **Move.** Drag to rotate, scroll to zoom, right-drag to pan. `1` `2` `3` `4` are the 3D, front, side and ρ–z
   views. The **Look at** bar (or `D`) shows one part of the detector at a time: Physics, Tracker, Calo, HGCal,
   Muons, or All. `Home` shows everything again.
2. **Go through events.** `→` and `←`, or type an event number in the **Event…** box. `P` plays a tour of the event:
   it is built up step by step, from the collision point outwards and from hits to physics objects, with a caption.
3. **Click something.** A jet, a track, a cluster, a hit. Its card (right) shows what it is part of and what it is
   made of, down to the hits. `↓` and `↑` draw one step of that chain at a time; click a name in the card to look at
   that object; `Esc` goes back.
4. **Ask the simulation.** `T` switches the colours from the reconstruction to the truth: every object in the colour
   of the generator particle it comes from. With an object selected, `X` crosses to its truth match and back, and the
   card says how good the match is (purity, completeness). What these mean: [Truth](truth.md).
5. **Cut the clutter.** In the side panel, each kind of object has its cut as a chip ("pT ≥ 30 GeV"): click it for a
   slider. **only** on a heading shows that kind alone. A click on a row's count lists its largest objects.

## 5. Share a link

The share button (top right) copies a link to what is on screen and shows what the link opens: the data set, the
event, the part of the detector, the view, the selection and the colours. Anyone who can open the site sees the same.
Cuts, ticked collections and the camera position are not part of a link.

The address bar holds the same link at all times, so copying it works too. A link to one of your files works while
the file is on the site ([30 days](#6-your-files) from when you last published it); after that the reader is told
that the file is gone and whose it was.

## 6. Your files

In the viewer, **My files** in the data set chooser lists what you published, most recently published first, with
the number of events and when each expires. The site knows who you are from the sign-on; where it does not, the chooser asks for
your CERN login once and remembers it in that browser. Other people's files are not listed anywhere: they are
reached by link, and a link you opened is then under **Recent**.

From the shell:

```
$ evd list
NAME                EVENTS  SIZE  EXPIRES     TITLE
step3_inNANOAODSIM  10      8 MB  2026-12-13  step3_inNANOAODSIM · 10 events
$ evd list -l          # with each link
$ evd rm step3_inNANOAODSIM
removed step3_inNANOAODSIM
```

A bundle is kept **30 days** after it was last published. Publishing the same name again replaces it and starts the
30 days again; the link stays the same. With nothing published, `evd list` says so. There is no quota per person yet: please remove what you no longer need.

## 7. Keep it to yourself

Nothing has to go to the site:

```bash
evd step3_inNANOAODSIM.root -o mine.evdb     # or --no-publish: writes step3_inNANOAODSIM.evdb here
```

Then drop `mine.evdb` on the viewer's page (or **Open a local file…** in the chooser). The file is read where it is,
by your browser, and is not uploaded; it has no link, and the share button says so. `evd inspect mine.evdb` and
`evd validate mine.evdb` describe and check a bundle without a browser.

## What works today

| | state |
|---|---|
| `NANO:@EVD` in CMSSW | two branches for CMSSW_20_1_X, to become two pull requests (generic table producers; the flavour, `eventdisplay-nano`), not pushed or merged yet. The RelVal workflow added for it (`29634.214`) passes. Phase-2 full simulation only: Run 3, FastSim, premixed pile-up and data are untested |
| `evd` on NanoAOD and on step3 files | works; geometry detection covers Run4 geometries described by XML files |
| the CMS site, `/eos/project/c/cms-evd/bin/evd`, shared RelVal samples | not set up yet: addresses provisional. Until then `evd FILE.root -o FILE.evdb` and a viewer you can reach (a development server, see the repository's README) |
| the viewer | checked in Chromium (the browser tests run there); other current browsers are expected to work and are not tested. A PU200 event is an 18 MB download |
| who you are on the site (`whoami`) | untested on the real site; the typed login is the fallback |

Numbers on this page were measured on ttbar events, geometry `ExtendedRun4D104`, with the integration build
CMSSW_20_1_X_2026-11-12-2300:

| per event | no pile-up | 200 pile-up |
|---|---|---|
| NanoAOD (`NANO:@EVD`) | 0.95 MB | 21.7 MB |
| making it from a step3 file, 8 threads | 0.3 s | 1.6 s |
| bundle (`.evdb`) | 0.85 MB | 18 MB |
| `evd`: NanoAOD to bundle, 4 threads | 0.1 s | 1.2 s |
