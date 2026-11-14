# Questions and problems

What new users run into, and what to do. Every message of the `ember` command is listed, with what to do, in
[The `ember` command](cli.md#messages-and-what-to-do).

## Getting events in

**`ember: ... has none of the tables that the profile cms draws (it has: Jet, Muon, ...)`**

The file is analysis NanoAOD. The event display needs the detector-level tables that CMSSW writes with the
`NANO:@EVD` step ([Getting started, step 2](getting-started.md#step-2-make-the-event-display-nanoaod)). MiniAOD and
analysis NanoAOD do not hold the hits or the links between objects.

**`ember` says that the release has no `NANO:@EVD`, or cmsDriver says "Impossible to map EVD".**

Your release does not have the event-display NanoAOD yet. Until it is merged, add it to your CMSSW area with
`git cms-merge-topic mmarriot:eventdisplay-nano && scram b`, once the branch is pushed
([What you need](getting-started.md#what-you-need)).

**`ember: display EcalHits: no column halfWidth`** (or another table and column)

The file and the converter come from different versions, and the tables changed between them. Use the `ember` that
goes with the release that wrote the file. The first line that `ember` prints names that release. `ember --version`
names the converter.

**`ember: cannot reach ...` or `ember: cannot write ...: root://eosproject.cern.ch/ refused`**

You have no valid Kerberos ticket. Run `kinit <your login>@CERN.CH`, then try again. On lxplus the site is a mounted
folder, and your login is enough.

**`ember: cannot tell which geometry it was made with`**

Give the geometry: `ember step3.root --geometry D110`. If the file was not made with the release's defaults for that
geometry, also give `--era` and `--conditions`. `ember` can detect only Run4 geometries that are described by XML
files.

**The export job fails on my step3 file.**

`ember` prints the end of the cmsRun log. The usual reasons are:

- The file was made with a release other than the one you are in. Use the same release.
- The file was made with an era or process modifiers that differ from the release's defaults for its geometry. Give
  `--era`. `ember` cannot pass process modifiers yet: run the `cmsDriver.py` command
  [by hand](how-to.md#convert-a-step3-file-you-already-have) with `--procModifiers`.
- The file's event content lacks what the tables read. `FEVTDEBUGHLT` and `RECOSIM` are the tested event contents.

**My account name on this machine is not my CERN login.**

Set `EMBER_USER=<your CERN login>`, or add `--user <your CERN login>`. Then the bundle goes to the user area that the
viewer lists as yours.

**Does it work for Run 3, or for real data?**

This is not tested. The `NANO:@EVD` step is written and measured for Phase-2 full simulation. The truth tables need
the truth graph, and only those samples have it.

**Can I convert only some events?**

Yes. `--events 416622,416630-416640` takes event numbers. `--max-events N` takes the first N events. For a step3
file, `--events` makes the NanoAOD of the whole file first, to find the events.

## In the viewer

**The page says that the file is gone.**

The site removes a bundle in a user area 30 days after it was last published. The owner can also remove it earlier.
The page names the owner: ask them to run `ember` on the file again. The same name gives the same link.

**"My files" is empty, or asks for my login.**

The site could not tell who you are, so the viewer asks once. Type your CERN login. If the list is still empty, run
`ember list`: it shows what the site has under your name. If you published from a machine where your account has
another name, the bundle is under that name (see `EMBER_USER` above).

**I dropped a file on the page, and the share button gives no link.**

Your browser reads a dropped file from your computer. The file is not on the site, so it has no link. To get a link,
publish the file it was made from: `ember FILE.root`.

**The link I sent opens the right event, but not my cuts.**

A link keeps the data set, the event, the part of the detector, the view, the selection and the colours. It does not
keep the cuts, the ticked collections or the camera position.

**An event at 200 pile-up takes a while to open.**

Such an event is an 18 MB download, and about 500,000 hits to draw. `--max-events` does not change this. What helps:
the cuts in the side panel, and looking at one part of the detector at a time (the **Look at** bar).

**A reconstructed object has no truth match, or says "no truth".**

Either the simulation has nothing for it, or CMSSW has no associator for that kind of object yet (jets, electrons,
muons, taus, missing momentum). The tag on each step of the selection's card says which.
[Truth](truth.md#where-truth-stops) and [Truth graph](truth-graph.md#gap-table) list the kinds without truth.

**Everything is grey in the truth colours.**

The bundle has no truth. Either the input was made without the truth graph (FastSim, or an era without the
`enableTruth` modifier), or the file's truth tables are empty. Run `ember inspect FILE.ember`: it shows the bundle's
relations and the largest tables of the first events. Look for `TruthParticles`.

## Everything else

**Where does my data go?**

To the CMS site's storage, in `data/u/<your login>/`. CMS members who have the link can read it. The site is behind
the CERN single sign-on, so it is not public. With `-o FILE.ember`, nothing leaves your machine.

**Can I use Ember without the site?**

Yes. Write a file with `ember FILE.root -o FILE.ember`, and drop it on any viewer page. See
[Look at a bundle without the site](how-to.md#look-at-a-bundle-without-the-site).

**How do I report a problem?**

[Open an issue](https://github.com/mmarriot/ember/issues). Give the `ember: ...` line (or the traceback that
`EMBER_DEBUG=1` prints), the output of `ember --version`, and the release that wrote the file.
