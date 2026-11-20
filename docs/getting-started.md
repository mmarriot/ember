# Getting started

This tutorial takes you from a CMS file to an event in your browser. Follow the steps in order.

You will:

1. get the `ember` command;
2. turn a file into a bundle with `ember`;
3. open the bundle in the viewer;
4. look around the event;
5. share it.

> **The CMS site is not set up yet.** `ember` writes the bundle on your machine, and you open it in the viewer at
> https://marriot-evd.web.cern.ch. Your browser reads the file from your disk: nothing is uploaded. Links to your own
> bundles need a site that holds them, which is planned ([Hosting](hosting.md)). See [Status](index.md#status).

**Only want to look?** Open https://marriot-evd.web.cern.ch and sign on with your CERN account. It opens one of its
data sets: ttbar events at 0 and 200 pile-up, HGCal cassette tests and test beam. Then go to
[step 4](#step-4-look-at-the-event). Or drop `golden/v6_1event.ember` from the repository on the page: it is one
simulated event.

## What you need

- **A CMSSW release for Phase 2 or Run 3, and `cmsenv` in it**, for a reconstruction file or a MiniAOD. `ember`
  writes its cmsRun configuration from the modules that this release has. Use the release that made your file, or a
  newer one of the same cycle. `ember` was tested with the integration build CMSSW_20_1_X_2026-11-17-2300. In an
  older release, the tables whose modules it lacks are left out, and the configuration says which.
- **Python 3.9 or later with numpy and uproot.** `cmsenv` gives you all three. A NanoAOD file needs nothing else.
- **A CERN account**, to open the viewer at https://marriot-evd.web.cern.ch (it is behind the CERN single sign-on).

> **Optional: more in your bundles.** Two CMSSW branches, not merged yet, add the hits of each cluster and the truth
> graph. Add them to your CMSSW area with `git cms-merge-topic` and build. `ember` uses them when it finds them. See
> [Get every table: the CMSSW branches](how-to.md#get-every-table-the-cmssw-branches).

## Step 1: Get the `ember` command

`ember` is a single file. It runs in any CMSSW environment, with nothing to install. Choose one way to get it.

**From a clone of the repository** (works anywhere):

```bash
git clone https://github.com/mmarriot/ember.git
python3 ember/tools/build_zipapp.py ~/bin/ember
```

This writes the file `~/bin/ember`. If `~/bin` is not in your `PATH`, call it as `~/bin/ember`, or add `~/bin` to your
`PATH`.

**With pip** (outside CMSSW, or in a Python virtual environment):

```bash
python3 -m pip install git+https://github.com/mmarriot/ember.git
```

**Check that it works:**

```
$ ember --version
ember 0.2.0
```

**If it fails:**

- `command not found`: the command is not in your `PATH`. Give its full path, for example `~/bin/ember --version`.
  After `pip install` outside a virtual environment, `ember` is usually in `~/.local/bin`.
- `No module named 'numpy'` (or `'uproot'`): this Python lacks a package that Ember needs. Run `cmsenv` first.

## Step 2: Turn a file into a bundle

Run `ember` on your file, after `cmsenv`. Here it is a Phase-2 step3 file of 20 ttbar events without pile-up:

```
$ ember step3.root
step3.root: CMSSW EDM (RECO, AOD or MiniAOD) from CMSSW_20_1_X_2026-11-12-2300, 20 events
making the NanoAOD of the first 10 with cmsRun
  geometry ExtendedRun4D104 (from the file's geometry files)
  conditions 201X_mcRun4_realistic_v1 (the file's global tag, ...)
  era Phase2C22I13M9 (this release's default for ExtendedRun4D104; the file does not record its era)
  left out: the hits of clusters: this release has no CaloClusterHitsTableProducer, ...
  left out: this release has no TruthGraphFlatTableProducer, TruthGraphHitFlatTableProducer (the truth tables: ...)
  running cmsRun ember_cfg.py (--config FILE.py keeps it)
  NanoAOD made in 29 s
  profile phase2 (chosen for the tables of ember_nano.root)
  29 tables, 8 relations, 29 display layers
  10 events, 4 MB, 0 s
wrote step3.ember
to see it, drop it on https://marriot-evd.web.cern.ch (your browser reads the file; nothing is uploaded)
```

**What happened:**

1. `ember` found the geometry, conditions and era that the file was made with, and printed them.
2. It wrote a cmsRun configuration, `ember_cfg.py`, from the modules of your release: the tables of the hits, clusters,
   tracksters, tracks and physics objects that the file has. It lists what it left out, here the hits of each cluster
   and the truth tables, which need CMSSW branches until they are merged. Add `--config mine_cfg.py` to keep the
   configuration, to read it or to run it again with `cmsRun`.
3. It ran the configuration on the first 10 events, in a temporary folder.
4. It converted the NanoAOD into a bundle, with the profile that draws most of it, and wrote `step3.ember` in the
   current folder. Ask for more events with `--max-events 50`, or for all with `--max-events 0`.

The cmsRun job takes about 20 s to start, then 0.6 s per event without pile-up, or 0.7 s per event at 200 pile-up,
with 4 threads (`-j 8` gives it 8). A NanoAOD file is converted directly, with no CMSSW job, in a few seconds.

Which files work, and what each one gives, is in [Which files work](how-to.md#which-files-work). If `ember` cannot
tell the geometry, or your file was made with other settings, see
[Convert a step3 file](how-to.md#convert-a-step3-file-you-already-have).

**If it fails**, `ember` prints one line that starts with `ember:`. The most common ones:

| message | what to do |
| --- | --- |
| `this is a CMSSW reconstruction file: ... so run cmsenv in a release first` | Run `cmsenv` in a CMSSW release for Phase 2 or Run 3, then try again. |
| `... failed in the CMSSW environment: run cmsenv in this shell ...` | This shell's `python3` or `PATH` is not the release's (for example an LCG view sourced after `cmsenv`). Run `cmsenv` again. |
| `FILE: cannot tell which geometry it was made with (...)` | Give the geometry, for example `--geometry D110`. |
| `the export job failed (exit code N); ...` | The cmsRun job failed. Its last lines follow, and the log and the configuration are kept in the files named. A wrong era or wrong conditions end here: give `--era` and `--conditions`. |
| `FILE: none of the profiles phase2, run3, nano, hgcal, cms draws its tables (it has: ...)` | `ember` does not know this kind of NanoAOD. See [Profiles](profiles.md). |

Every message, and what to do about it, is in [The `ember` command](cli.md#messages-and-what-to-do).

## Step 3: Open the bundle

1. If you ran `ember` on another machine (lxplus, for example), copy the bundle to the computer where your browser
   is: `scp <your login>@lxplus.cern.ch:path/to/step3.ember .`
2. Open https://marriot-evd.web.cern.ch, and sign on with your CERN account.
3. Drop `step3.ember` on the page. Or open the data set chooser (the button at the left of the top bar) and click
   **Open a local file…** at its bottom.

Your browser reads the file where it is. It is not uploaded. Any copy of the viewer does the same, also one that you
run yourself ([Look at a bundle without the site](how-to.md#look-at-a-bundle-without-the-site)).

## Step 4: Look at the event

You see the first event of the bundle. Press `?` at any time for the viewer's own help. Now try these five things:

1. **Move around.** Drag to rotate, scroll to zoom, and right-drag to pan. Press `1`, `2`, `3` or `4` for the 3D,
   front, side and ρ–z views. Use the **Look at** bar at the top (or press `D`) to show one part of the detector:
   Physics, Tracker, Calo, HGCal, Muons, or All. Press `Home` to see everything again.
2. **Go through the events.** Press `→` and `←`. Or type an event number in the **Event…** box. Press `P` for a
   tour: the viewer builds up the event step by step, from the collision point outwards and from hits to physics
   objects, with a caption for each step.
3. **Click an object**, for example a jet, a track, a cluster or a hit. Its card opens on the right. The card shows
   what the object is part of, and what it is made of, down to the hits. Press `↓` and `↑` to draw one step of this
   chain at a time. Click a name in the card to look at that object. Press `Esc` to go back.
4. **Compare with the simulation**, when the bundle has truth. Press `T` to colour everything by the simulated
   particle it comes from. Select an object and press `X` to jump to its truth match, and `X` again to come back. The
   card says how good the match is, as purity and completeness. Select a particle to see, detector by detector, where
   its energy went: in the reco object matched to it, in others, or in none. [Truth](truth.md) explains these words.
5. **Hide what you do not need.** In the side panel, each kind of object shows its cut, for example
   "pT ≥ 30 GeV". Click the cut to change it with a slider. Click **only** on a heading to show that kind alone.
   Click the count on a row to list its largest objects.

All the controls are described in [Viewer](viewer.md).

## Step 5: Share it

A bundle on your disk has no link. To show it to a colleague, send them the file (on EOS or CERNBox, for example).
They open it the same way, in step 3.

Links that open the same event, the same selected object and the same view work for bundles that a site holds: the
data sets of https://marriot-evd.web.cern.ch, and your own bundles once the planned CMS site exists. The share
button at the top right copies such a link, and lists what it opens. For a local file, it says that the file has no
link.

## What next

- [How-to guides](how-to.md): which files work, convert a step3 file, choose events, name your bundle, get the cluster
  hits and the truth.
- [Questions and problems](faq.md): what new users run into.
- [Viewer](viewer.md): every control, the side panel, colours and the selection's card.
- [The `ember` command](cli.md): every option and message.
