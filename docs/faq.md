# Questions and problems

What a first user runs into. Every message of the `evd` command, with what to do, is in
[The `evd` command](cli.md#messages-and-what-to-do).

## Getting events in

**`evd: ... has none of the tables that the profile cms draws (it has: Jet, Muon, ...)`.**
The file is analysis NanoAOD. The event display needs the detector-level tables that CMSSW writes with the
`NANO:@EVD` step ([Getting started](getting-started.md#2-your-own-events-from-a-new-reconstruction-job)); MiniAOD
and analysis NanoAOD do not hold hits or the links between objects.

**`evd` says the release has no `NANO:@EVD`, or cmsDriver says "Impossible to map EVD".**
The release does not have the event-display NanoAOD. Until it is merged:
`git cms-merge-topic mmarriot:eventdisplay-nano && scram b` in your area
([Before you start](getting-started.md#before-you-start)).

**`evd: display EcalHits: no column halfWidth` (or another table and column).**
The file and the converter are of different versions: the tables changed between them. Use the `evd` that goes with
the release that wrote the file. The first line `evd` prints names that release; `evd --version` names the
converter.

**`evd: cannot write ...: root://eosproject.cern.ch/ refused`.**
No valid Kerberos ticket: `kinit <login>@CERN.CH` and run it again. On lxplus the site is a mounted directory and no
ticket beyond your login is needed.

**`evd: cannot tell which geometry it was made with`.**
Give it: `evd step3.root --geometry D110` (and `--era`, `--conditions` if the file was not made with the release's
defaults for that geometry). Detection covers Run4 geometries described by XML files.

**The export job fails on my step3 file.**
`evd` prints the end of the cmsRun log. The usual reasons: the file was made with another release than the one you
are in (use the same one); with an era or process modifiers that differ from the release's default for its geometry
(`--era`; process modifiers cannot be passed yet: run the `cmsDriver.py` command of
[Getting started](getting-started.md#3-a-step3root-you-already-have) by hand with `--procModifiers`); or with an
event content that lacks what the tables read (`FEVTDEBUGHLT` and `RECOSIM` are what is tested).

**My account name here is not my CERN login.**
Set `EVD_USER=<CERN login>` (or `--user`), so that the bundle goes to the area the viewer lists as yours.

**Does it work for Run 3, or for data?**
Not tested. The flavour is written and measured for Phase-2 full simulation; the truth tables need the truth graph,
which only those samples have.

**Can I see only some events?**
`--events 416622,416630-416640` takes event numbers; `--max-events N` the first N. For a step3 file `--events` exports
the whole file first to find them.

## In the viewer

**The page says the file is gone.**
Bundles in users' areas are removed 30 days after they were last published, or by their owner. The panel names the
owner: ask them to run `evd` on the file again (the same name gives the same link).

**"My files" is empty, or asks for my login.**
The site could not tell who you are, so the chooser asks once: type your CERN login. If the list is still empty,
`evd list` shows what the site has under your name; a file published from a machine where your account has another
name is under that name (see `EVD_USER` above).

**I dropped a file on the page and the share button gives no link.**
A local file is read by your browser and is not on the site. Publish the file it was converted from
(`evd FILE.root`) to get a link.

**The link I sent opens the right event but not my cuts.**
A link keeps the data set, the event, the part of the detector, the view, the selection and the colour mode. Cuts,
ticked collections and the camera position are not part of it.

**A 200 pile-up event takes a while to open.**
It is an 18 MB download per event and about 500,000 hits to draw. `--max-events` does not change that; the cuts in
the side panel and looking at one part of the detector (the **Look at** bar) do.

**A reco object has no truth match, or says "no truth".**
Either the simulation has nothing for it, or CMSSW has no associator for that kind of object yet (jets, electrons,
muons, taus, MET). The tag on each step of the selection's card says which; [Truth](truth.md#where-truth-stops) and
[Truth graph](truth-graph.md#gap-table) list them.

**Everything is grey in the truth colours.**
The bundle has no truth: the input was made without the truth graph (FastSim, or an era without `enableTruth`), or
the file's truth tables are empty. `evd inspect FILE.evdb` lists the tables; look for `TruthParticles`.

## Everything else

**Where does my data go?**
To the CMS site's storage, in `data/u/<your login>/`, readable by CMS members who have the link (the site is behind
the CERN sign-on; it is not public). With `-o FILE.evdb` nothing leaves your machine.

**Can I use it without the site?**
Yes: `evd FILE.root -o FILE.evdb`, and drop the file on any running viewer. The repository's README says how to run
one locally.

**How do I report a problem?**
[Open an issue](https://github.com/mmarriot/evd/issues) with the `evd: ...` line (or, with `EVD_DEBUG=1`, the
traceback), the output of `evd --version`, and the release that wrote the file.
