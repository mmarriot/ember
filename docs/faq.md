# Questions and problems

What new users run into, and what to do. Every message of the `ember` command is listed, with what to do, in
[The `ember` command](cli.md#messages-and-what-to-do).

## Getting events in

**`ember: FILE: none of the profiles phase2, run3, nano, hgcal, cms draws its tables (it has: ...)`**

The file is a kind of NanoAOD that no built-in profile knows: its tables have other names. Standard NanoAOD,
`NANO:@HGCAL` and the NanoAOD that `ember` writes all work. For another kind, write a profile and give it with
`--profile` ([Profiles](profiles.md)).

**My bundle has only physics objects: no hits, clusters or tracks.**

The input was a MiniAOD or a NanoAOD. They do not hold the hits or the clusters: `ember` can draw only what the file
has. Run `ember` on the reconstruction file (RECO or FEVT) of the same events instead
([Which files work](how-to.md#which-files-work)).

**`ember` says `left out: the hits of clusters: this release has no CaloClusterHitsTableProducer, ...`**

The hits of each cluster need a CMSSW branch that is not merged yet. Without it, the clusters are drawn, but selecting
one does not show its hits. Add the branch to your CMSSW area with `git cms-merge-topic mmarriot:nanoaod-cluster-hits`
and build ([Get the cluster hits and the truth](how-to.md#get-the-cluster-hits-and-the-truth)).

**`ember: display EcalHits: no column halfWidth`** (or another table and column)

The file and the converter come from different versions, and the tables changed between them. Use the `ember` that
goes with the release that wrote the file. The first line that `ember` prints names that release. `ember --version`
names the converter.

**`ember: cannot reach ...` or `ember: cannot write ...: root://eosproject.cern.ch/ refused`** (publishing to a site)

You have no valid Kerberos ticket. Run `kinit <your login>@CERN.CH`, then try again. On lxplus the site is a mounted
folder, and your login is enough.

**`ember: cannot tell which geometry it was made with`**

Give the geometry: `ember step3.root --geometry D110`. If the file was not made with the release's defaults for that
geometry, also give `--era` and `--conditions`. `ember` can detect only Run4 geometries that are described by XML
files.

**The export job fails on my step3 file.**

`ember` prints the end of the cmsRun log, and keeps the whole log and `ember_cfg.py` in the files it names. The usual
reasons are:

- The file was made with an era or conditions other than the ones `ember` found. Give `--era` and `--conditions`.
- The release is older than the one that made the file, or than the modules the configuration names. Use the
  release that made the file, or a newer one. A module that CMSSW renamed or changed also ends here: please
  [report it](https://github.com/mmarriot/ember/issues).

Process modifiers (such as `ticl_v6`) do not need to be given: `ember_cfg.py` runs no reconstruction, only modules
that write tables. To look into a failure, keep the configuration with `--config FILE.py`, and run `cmsRun FILE.py`
yourself.

**My account name on this machine is not my CERN login.**

Set `EMBER_USER=<your CERN login>`, or add `--user <your CERN login>`. Then the bundle goes to the user area that the
viewer lists as yours.

**Does it work for Run 3, or for real data?**

Yes. `ember` reads Run 3 RECO, data and simulation (tested on JetMET 2025C data), Run 3 MiniAOD and any NanoAOD. Run 3
files have no truth graph, so their bundles have no truth. Run 2 and older files are not supported.

**Can I convert only some events?**

Yes. `--events 416622,416630-416640` takes event numbers. `--max-events N` takes the first N events. For a step3
file, `--events` makes the NanoAOD of the whole file first, to find the events.

## In the viewer

**The page says that the file is gone.**

The site removes a bundle in a user area 30 days after it was last published. The owner can also remove it earlier.
The page names the owner: ask them to run `ember` on the file again. The same name gives the same link (and an old
link that ends in `.evdb` opens the new `.ember` file).

**"My files" is empty, or asks for my login.**

The site could not tell who you are, so the viewer asks once. Type your CERN login. If the list is still empty, run
`ember list`: it shows what the site has under your name. If you published from a machine where your account has
another name, the bundle is under that name (see `EMBER_USER` above).

**I dropped a file on the page, and the share button gives no link.**

Your browser reads a dropped file from your computer. The file is not on the site, so it has no link. Send the file
itself: the other person drops it on the viewer too. Links to your own bundles need a site that holds them: the CMS
site is planned ([Hosting](hosting.md)).

**The link I sent opens the right event, but not my cuts.**

A link keeps the data set, the event, the part of the detector, the view, the selection, a kind of object shown alone
and the colours. It does not
keep the cuts, the ticked collections or the camera position.

**An event at 200 pile-up takes a while to open.**

Such an event is about 5 MB to read without truth, about 17 MB with it (20 to 30 MB in the ttbar data sets of
https://marriot-evd.web.cern.ch), and several hundred thousand hits to draw. `--max-events` does not change this.
What helps: the cuts in the side panel, and looking at one part of the detector at a time (the **Look at** bar).

**A reconstructed object has no truth match, or says "no truth".**

Either the simulation has nothing for it, or CMSSW has no associator for that kind of object yet (jets, electrons,
muons, taus, missing momentum). The tag on each step of the selection's card says which.
[Truth](truth.md#where-truth-stops) and [Truth graph](truth-graph.md#gap-table) list the kinds without truth.

**Everything is grey in the truth colours.**

The bundle has no truth. Either the release that ran `ember_cfg.py` had no truth graph tables (they need a CMSSW
branch for now: [Get the cluster hits and the truth](how-to.md#get-the-cluster-hits-and-the-truth)), or the input has
no truth graph (AOD, MiniAOD, NanoAOD, Run 3, FastSim, premixed pile-up, or an era without the `enableTruth`
modifier), or the file's truth tables are empty. Run `ember inspect FILE.ember`: it shows the bundle's
relations and the largest tables of the first events. Look for `TruthParticles`.

## Everything else

**Where does my data go?**

Nowhere. `ember` writes the bundle on your machine, and when you drop it on the viewer, your browser reads it from
your disk: nothing is uploaded. Only with a site configured (`--site` or `EMBER_SITE_DIR`) does `ember` copy the
bundle to that site, in `data/u/<your login>/`.

**Can I use Ember without the site?**

Yes, that is the default. You can also run a viewer yourself: see
[Look at a bundle without the site](how-to.md#look-at-a-bundle-without-the-site).

**How do I report a problem?**

[Open an issue](https://github.com/mmarriot/ember/issues). Give the `ember: ...` line (or the traceback that
`EMBER_DEBUG=1` prints), the output of `ember --version`, and the release that wrote the file.
