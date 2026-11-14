# Getting started

This tutorial takes you from a CMSSW reconstruction job to an event in your browser, and to a link that you can send
to a colleague. Follow the steps in order.

You will:

1. get the `evd` command;
2. make the event-display NanoAOD in your CMSSW job;
3. turn it into a link with `evd`;
4. open the event and look around;
5. share the link;
6. tidy up.

> **The site is not set up yet.** This page uses `https://cms-evd.web.cern.ch` and `/eos/project/c/cms-evd/` for the
> CMS site. These addresses are provisional. Until the site exists, step 3 cannot publish: write a file instead, as
> step 3 explains. See [Status](index.md#status).

**Only want to look?** Once the site is set up, you will not need to run anything. Open
`https://cms-evd.web.cern.ch` (provisional) and sign on with your CERN account. The site opens its newest shared
sample. Then go to [step 4](#step-4-look-at-the-event).

**Want to see the viewer right now?** You can do it on your own computer without CMSSW or the site. Follow
[Look at a bundle without the site](how-to.md#look-at-a-bundle-without-the-site) and drop
`golden/v6_1event.evdb` from the repository on the page: it is one simulated event. Then go to
[step 4](#step-4-look-at-the-event).

## What you need

- **A CERN account that is a member of CMS.** The site is behind the CERN single sign-on.
- **A CMSSW area for Phase-2 full simulation that has the `NANO:@EVD` step.** See the box below.
- **Python 3.9 or later with numpy and uproot.** `cmsenv` gives you all three.
- **Off lxplus:** a Kerberos ticket and the XRootD tools, so that `evd` can write to EOS. Run
  `kinit <your login>@CERN.CH`, and `cmsenv` (it puts `xrdcp` and `xrdfs` in your `PATH`).

<!-- Delete this box once the CMSSW pull requests are merged. -->
> **Until the CMSSW pull requests are merged.** No CMSSW release has `NANO:@EVD` yet.
> Add it to a recent CMSSW_20_1_X integration build. `scram list -c CMSSW_20_1_X` lists the builds; they expire
> after a few weeks. Do this once:
>
> ```bash
> cmsrel CMSSW_20_1_X_<date> && cd CMSSW_20_1_X_<date>/src && cmsenv
> git cms-merge-topic mmarriot:eventdisplay-nano
> scram b -j 8
> ```
>
> The branch is not public yet, so `git cms-merge-topic` works only once it is pushed. The rest of this page is the
> same either way.

## Step 1: Get the `evd` command

`evd` is a single file. It runs in any CMSSW environment, with nothing to install. Choose one way to get it.

**From a clone of the repository** (works anywhere):

```bash
git clone https://github.com/mmarriot/evd.git
python3 evd/tools/build_zipapp.py ~/bin/evd
```

This writes the file `~/bin/evd`. If `~/bin` is not in your `PATH`, call it as `~/bin/evd`, or add `~/bin` to your
`PATH`.

**On lxplus, once the site is set up:** use the copy kept next to the site (provisional path):

```bash
alias evd=/eos/project/c/cms-evd/bin/evd
```

**With pip** (outside CMSSW, or in a Python virtual environment):

```bash
python3 -m pip install git+https://github.com/mmarriot/evd.git
```

**Check that it works:**

```
$ evd --version
evd 0.2.0
```

**If it fails:**

- `command not found`: the command is not in your `PATH`. Give its full path, for example `~/bin/evd --version`.
  After `pip install` outside a virtual environment, `evd` is usually in `~/.local/bin`.
- `No module named 'numpy'` (or `'uproot'`): this Python lacks a package that evd needs. Run `cmsenv` first.

## Step 2: Make the event-display NanoAOD

evd reads a special NanoAOD file, the *event-display NanoAOD*. Your reconstruction job writes it when you add one
step. Normal analysis NanoAOD does not work: it has no hits.

> **Do you already have a step3 file?** Then skip this step. In step 3, give `evd` your `step3.root`. `evd` then
> makes the NanoAOD for you. This needs `cmsenv` in a release that has `NANO:@EVD`.

Take the `cmsDriver.py` command that you already use for step3, and add three things:

- `NANO:@EVD` at the end of the steps (`-s`);
- `NANOAODSIM` at the end of `--eventcontent`;
- `NANOAODSIM` at the end of `--datatier`.

For example:

```bash
cmsDriver.py step3 -s RAW2DIGI,RECO,RECOSIM,NANO:@EVD \
    --conditions auto:phase2_realistic_T35 --geometry ExtendedRun4D104 --era Phase2C22I13M9 \
    --eventcontent FEVTDEBUGHLT,NANOAODSIM --datatier GEN-SIM-RECO,NANOAODSIM \
    --filein file:step2.root --fileout file:step3.root -n -1 --nThreads 16
```

Keep your own conditions, geometry, era and other options.

**What you should see:** the job writes `step3.root` as before. Next to it, it writes `step3_inNANOAODSIM.root`. This
is the event-display NanoAOD: the same events, as tables.

The extra step costs little. On a job of 20 ttbar events without pile-up, it changed neither the job's run time nor
its memory by a measurable amount ([costs](cmssw.md#what-it-costs)).

**If it fails** with `Impossible to map EVD`: your CMSSW area does not have the `NANO:@EVD` step. Add it as
[What you need](#what-you-need) explains.

## Step 3: Turn the file into a link

Run `evd` on the NanoAOD file:

```
$ evd step3_inNANOAODSIM.root
step3_inNANOAODSIM.root: NanoAOD from CMSSW_20_1_X_2026-11-12-2300, 20 events
  44 tables, 86 relations, 43 display layers
  10 events of 20 (--max-events 0 for all), 8 MB, 1 s
published step3_inNANOAODSIM: kept until 2026-12-13 (evd list, evd rm step3_inNANOAODSIM)

https://cms-evd.web.cern.ch/#b=data/u/jsmith/step3_inNANOAODSIM.evdb
```

**What happened:**

1. `evd` read the tables in the file.
2. It wrote the first 10 events as a bundle (a `.evdb` file). Ask for more with `--max-events 50`, or for all with
   `--max-events 0`.
3. It copied the bundle to your user area on the site, `data/u/<your login>/`, and added it to your list there.
4. It printed the link on the last line.

The site keeps the bundle for 30 days.

**Starting from a step3 file instead?** Run `evd step3.root`. `evd` first runs a short CMSSW job that makes the
NanoAOD. It prints the geometry, conditions and era it chose. With 8 threads this took about 20 s to start, then
0.3 s per event without pile-up, or 1.6 s per event at 200 pile-up. `evd` runs the job with 4 threads unless you give
`-j`. If `evd` cannot tell the geometry, see [Convert a step3 file](how-to.md#convert-a-step3-file-you-already-have).

**While the site does not exist**, publishing fails with `the site directory ... does not exist`. Write the bundle to
a file instead:

```
$ evd step3_inNANOAODSIM.root -o mine.evdb
...
wrote mine.evdb
```

Then open a viewer and drop `mine.evdb` on the page ([Look at a bundle without the
site](how-to.md#look-at-a-bundle-without-the-site)). Skip step 5: a local file has no link.

**If it fails**, `evd` prints one line that starts with `evd:`. The most common ones:

| message | what to do |
| --- | --- |
| `... has none of the tables that the profile cms draws (it has: Jet, Muon, ...)` | This is analysis NanoAOD. Make the event-display NanoAOD as in [step 2](#step-2-make-the-event-display-nanoaod). |
| `the site directory ... does not exist` | The site is not set up, or not reachable from here. Use `-o FILE.evdb`, as above. |
| `cannot reach ...` or `cannot write ...: ... refused` | You have no valid Kerberos ticket. Run `kinit <your login>@CERN.CH`, then try again. |
| `xrdfs not found ...` (or `xrdcp`) | You are not on lxplus, and the XRootD tools are not in your `PATH`. Run `cmsenv`, then try again. |
| `'...' cannot be a login` | Your account name on this machine is not your CERN login. Add `--user <your CERN login>`. |

Every message, and what to do about it, is in [The `evd` command](cli.md#messages-and-what-to-do).

## Step 4: Look at the event

Open the link in your browser, and sign on with your CERN account if asked. You see the first event of your bundle.

Press `?` at any time for the viewer's own help. Now try these five things:

1. **Move around.** Drag to rotate, scroll to zoom, and right-drag to pan. Press `1`, `2`, `3` or `4` for the 3D,
   front, side and ρ–z views. Use the **Look at** bar at the top (or press `D`) to show one part of the detector:
   Physics, Tracker, Calo, HGCal, Muons, or All. Press `Home` to see everything again.
2. **Go through the events.** Press `→` and `←`. Or type an event number in the **Event…** box. Press `P` for a
   tour: the viewer builds up the event step by step, from the collision point outwards and from hits to physics
   objects, with a caption for each step.
3. **Click an object**, for example a jet, a track, a cluster or a hit. Its card opens on the right. The card shows
   what the object is part of, and what it is made of, down to the hits. Press `↓` and `↑` to draw one step of this
   chain at a time. Click a name in the card to look at that object. Press `Esc` to go back.
4. **Compare with the simulation.** Press `T` to colour everything by the simulated particle it comes from. Select an
   object and press `X` to jump to its truth match, and `X` again to come back. The card says how good the match is,
   as purity and completeness. [Truth](truth.md) explains these words.
5. **Hide what you do not need.** In the side panel, each kind of object shows its cut, for example
   "pT ≥ 30 GeV". Click the cut to change it with a slider. Click **only** on a heading to show that kind alone.
   Click the count on a row to list its largest objects.

All the controls are described in [Viewer](viewer.md).

## Step 5: Share the link

Click the share button at the top right. It copies a link to what is on your screen, and it lists what the link
opens: the data set, the event, the part of the detector, the view, a kind of object shown alone, the selected
object and the colours. Anyone who can open the site sees the same thing.

The link does not keep your cuts, your ticked collections or the camera position.

The address bar always holds the same link, so you can also copy it from there. A link to one of your bundles works
for 30 days after you last published it. After that, the page tells the reader that the file is gone, and whose it
was.

## Step 6: Tidy up

The viewer lists your bundles under **My files**: click the data set name at the left of the top bar. You can also
list them from the shell:

```
$ evd list
NAME                EVENTS  SIZE  EXPIRES     TITLE
step3_inNANOAODSIM  10      8 MB  2026-12-13  step3_inNANOAODSIM · 10 events
```

Remove a bundle that you no longer need:

```
$ evd rm step3_inNANOAODSIM
removed step3_inNANOAODSIM
```

There is no size limit per person yet. Please remove what you no longer need.

## What next

- [How-to guides](how-to.md): convert a step3 file, choose events, name your bundle, keep a bundle to yourself.
- [Questions and problems](faq.md): what new users run into.
- [Viewer](viewer.md): every control, the side panel, colours and the selection's card.
- [The `evd` command](cli.md): every option and message.
