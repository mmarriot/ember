# How-to guides

Short recipes for common tasks. Each one assumes that you have done [Getting started](getting-started.md) once. Every
option is listed in [The `ember` command](cli.md).

## Look at the sample data sets

Open https://marriot-evd.web.cern.ch, and sign on with your CERN account. It opens its newest data set.

To open another one, click the button at the left of the top bar. It shows the name of the data set that is open.
The data set chooser lists:

- **Recent**: the data sets you opened from someone's link, and local files by name;
- the site's **shared groups**: ttbar events at 0 and 200 pile-up, HGCal cassette tests at P5 (cosmic muons) and
  test beam data;
- **My files**: bundles you published to this site (see [Publish to a site](#publish-to-a-site)).

Type to filter the list. Use ↑ ↓ and Enter to open a data set, and Esc to close the chooser.

## Which files work

| input | what `ember` does | what the bundle has |
| --- | --- | --- |
| NanoAOD: standard NanoAOD (any `NANO` flavour), `NANO:@HGCAL`, or the NanoAOD that `ember` writes | converts it directly, with no CMSSW job; the profile is chosen by what the file has | standard NanoAOD: the physics objects (jets, electrons, photons, muons, taus, MET, vertices). `NANO:@HGCAL`: the HGCal hits, layer clusters, tracksters, TICL candidates and tracks. |
| Phase-2 reconstruction: step3 with `FEVTDEBUGHLT` or `RECOSIM` content (RelVal `GEN-SIM-RECO` files have it), stock or TICL v6 | writes and runs `ember_cfg.py` | HGCal hits, ECAL barrel and HCAL hits, layer clusters, tracksters, TICL candidates, PF clusters, superclusters, tracks, physics objects. The hits of each cluster, and the truth, with the optional CMSSW branches (below). |
| Run 3 reconstruction (RECO), data or simulation | writes and runs `ember_cfg.py`; the PF rechits are made again in the job, because RECO keeps only those that cleaning removed | ECAL barrel, endcap and preshower, HB, HE, HO and HF hits, PF clusters, superclusters, tracks, physics objects; the hits of each cluster with the optional branch. No truth. |
| AOD | writes and runs `ember_cfg.py` | the same, without the calorimeter hits that AOD does not keep: `ember_cfg.py` lists what it left out. Not tested on a whole AOD file. |
| MiniAOD, Phase 2 or Run 3 | runs `cmsDriver.py -s NANO` (standard NanoAOD) | the physics objects only: MiniAOD has no hits or clusters |
| Run 2 and older | stops: for data `run N is before Run 3`, for simulation `cannot tell the era of this Run 3 file` | |

Truth needs the truth graph in the input. The Phase-2 eras build it at the DIGI step and keep it in `FEVTDEBUGHLT` and
`RECOSIM`, with the pile-up of the in-time bunch crossing. AOD, MiniAOD, NanoAOD, premixed pile-up, FastSim and Run 3
files do not have it.

## Convert a step3 file you already have

After `cmsenv` in a CMSSW release ([Getting started](getting-started.md#what-you-need)):

```bash
ember step3.root
```

`ember` writes a cmsRun configuration, `ember_cfg.py`, from the modules of your release, runs it in a temporary
folder to make the NanoAOD, and converts it. It tells you which settings it used:

- **geometry** (Phase 2): read from the file. `ember` matches the list of geometry files that the job used with the
  release's Run4 geometries. Run 3 takes its geometry from the conditions.
- **conditions:** the newest global tag that the file names (for data, the newest Prompt or Express one). If the file
  names none, the release's default for the geometry.
- **era:** Phase 2, the release's default for that geometry; Run 3 data, the year of its run number; Run 3
  simulation, the year in its global tag. A file does not record its era.

If `ember` cannot tell, or if the file was made with other settings, give them yourself:

```bash
ember step3.root --geometry D110 --era Phase2C17I13M9 --conditions auto:phase2_realistic_T33
```

`ember_cfg.py` runs no reconstruction, only the modules that write tables, and those that make what the tables read: the
PF rechits where the input does not keep them (Run 3 RECO, AOD), and the truth associators. So the process modifiers
that your file was made with do not need to be given: TICL v6 files (made with `--procModifiers ticl_v6`) work as they
are.

To keep the configuration and the NanoAOD that `ember` made, add `--config ember_cfg.py --nano ember_nano.root`. `cmsRun
ember_cfg.py` runs the configuration again, in the same release, and `ember convert ember_nano.root -o NAME.ember`
converts its output. You can change the configuration first, for example to add a table: the header of the file lists
what it left out, and why.

**How long it takes:** with 4 threads, about 20 s for the job to start (Run 3 data: 16 s), then about 0.6 s per
event without pile-up, or 0.7 s per event at 200 pile-up (Run 3 data: 0.24 s). `-j 8` gives the job 8 threads.

## Get every table: the CMSSW branches

The release writes most of what the viewer draws. Eleven CMSSW branches add the rest; none is merged yet. Add them to
a CMSSW area of a recent CMSSW_20_1_X integration build (`scram list -c CMSSW_20_1_X` lists the builds; they expire
after a few weeks), once. All of them at once:

```bash
cmsrel CMSSW_20_1_X_<date> && cd CMSSW_20_1_X_<date>/src && cmsenv
git cms-merge-topic mmarriot:nanoaod-reco-tables-all    # every branch below, merged and tested together
scram b -j 8
```

or only the ones you want, each with its own `git cms-merge-topic mmarriot:<branch>`:

| branch | what the viewer gains |
|---|---|
| `nanoaod-cluster-hits` | the hits of every HGCal layer cluster, PF cluster and supercluster: select a cluster, see its hits |
| `truthgraph-nano-tables` | truth: the truth graph's particles, vertices and parent → child links, the simulated energy of each particle in each hit, and the reco ↔ truth matches (it contains [cms-sw/cmssw#52451](https://github.com/cms-sw/cmssw/pull/52451)) |
| `nanoaod-calo-rechits` | every ECAL and HCAL rechit, not only those particle flow uses |
| `nanoaod-track-hits` | the hits of the general, GSF and muon tracks (RECO and FEVT files; an AOD keeps none) |
| `nanoaod-vertex-tracks` | which tracks each primary and secondary vertex is made of |
| `nanoaod-pfcandidate-links` | each PF candidate's PF clusters and TICL candidate: the whole detector takes the candidates' colours |
| `nanoaod-reco-constituents` | the PF candidates of each jet and tau: select a jet, see what it is made of |
| `nanoaod-jet-tags` | the b-tags of the CHS jets (preset "DeepCSV (CHS jets)") |
| `nanoaod-mtd-rechits` | every BTL and ETL rechit (preset "Track time") |
| `muontools-rechits-chambers` | DT and CSC rechits, the chambers in use, and each muon's segments |
| `nanoaod-muon-track-links` | each muon's standalone track |

Then run `ember step3.root` in that area. `ember` sees the new modules and uses them. For each branch your area lacks,
the header of `ember_cfg.py` names it under "Left out", with the all branch. [CMSSW side](cmssw.md#the-cmssw-branches)
lists the tables each branch writes.

**Truth** needs a Phase-2 file that holds the graph ([Which files work](#which-files-work)). The reco ↔ truth
associations come from the file's own maps when it has them (the TICL v6 samples do); otherwise CMSSW's associators
run in the job, adding about 1 s per event at 200 pile-up. `--no-truth-associators` skips them: the bundle then has
the graph and the hit energies, but no reco ↔ truth matches.

## Get corrected jets, IDs and b-tags (`--pat`)

By default, the physics objects of a reconstruction file come straight from its RECO collections: AK4 Puppi jets
without energy corrections, IDs or b-tags, Puppi and PF MET, electrons, photons, muons, and the vertices. This costs
almost nothing. With `--pat`, `ember` takes them from PAT and standard NanoAOD instead (`cmsDriver.py -s PAT,NANO`):
corrected jets with their IDs and b-tags, and taus. It costs much more: at 200 pile-up, PAT and NANO alone took
2.25 s per event, 8.6 GB of memory and 32 s to start, where the whole job takes 0.7 s per event, 3.3 GB and 19 s
without it. [CMSSW side](cmssw.md#physics-objects-and-pat) has the details.

```bash
ember step3.root --pat
```

## Choose which events, and how many

By default `ember` converts the first 10 events. At 200 pile-up, an event is about 5 MB of bundle without truth (6 MB
with the cluster hits, about 17 MB with the truth), so a bundle of 10 such events is 50 to 170 MB.

| option | effect |
| --- | --- |
| `--max-events 50` | the first 50 events |
| `--max-events 0` | all events |
| `--events 3,7-9` | only these event numbers (the `event` of each event, not its position in the file) |

With `--events`, every event you ask for is converted, not only the first 10 (the profile's event selection still
applies). For a step3 file, `--events` makes the NanoAOD of the whole file first, to find them.

## Give your bundle a name and a title

By default the bundle takes the name of the first input file, without its extension. The title is what the viewer
shows in its lists.

```bash
ember step3.root --name ttbar_newtune --title "ttbar, new tune"      # writes ttbar_newtune.ember
```

A name starts with a letter or a digit. It can then hold letters, digits, `.`, `_` and `-`. `-o FILE.ember` writes
the bundle to another file.

Two commands describe and check a bundle without a browser:

```bash
ember inspect mine.ember      # what it holds: layers, relations, sizes, the first events
ember validate mine.ember     # checks the structure of every event
```

## Look at a bundle without the site

Any copy of the viewer opens a bundle that you drop on it. If you cannot reach https://marriot-evd.web.cern.ch, run
one yourself, on the computer where your browser is:

1. Copy the bundle to your computer, for example
   `scp <your login>@lxplus.cern.ch:path/to/mine.ember .`
2. In a clone of the repository, with Node 18 or later:

   ```bash
   cd viewer && npm ci && npm run dev      # then open http://127.0.0.1:5173
   ```

3. Drop `mine.ember` on the page.

[CONTRIBUTING](https://github.com/mmarriot/ember/blob/main/CONTRIBUTING.md#see-events-while-you-work) says how to list
bundles on this development server.

## Publish to a site

The CMS site, with a user area for each person, is planned and not available ([Hosting](hosting.md)). Until it
exists, publishing works only to a site that you set up and can write to, for example a test site. Give its folder
with `--site DIR` (or `EMBER_SITE_DIR`), and its address with `--url URL` (or `EMBER_SITE_URL`):

```bash
ember step3.root --site <site folder> --url <site address>
```

`ember` then copies the bundle to your user area on that site, `data/u/<your login>/`, adds it to your list there,
and prints a link on the last line. Anyone who can open the site and has the link sees the same event, the same
selected object and the same view. `--no-publish` writes the bundle here even with a site configured.

Publishing again under the same name replaces the bundle. The link stays the same, and the 30 days start again. (A
bundle published before the rename to Ember ends in `.evdb`. Publishing it again makes it `.ember` and prints a link
that ends in `.ember`, but the old `.evdb` link still opens it.)

### Manage your published bundles

**In the viewer:** open the data set chooser and look under **My files**. It lists your bundles, the most recently
published first, with the number of events and the date each one expires.

**In the shell:**

```bash
ember list             # your bundles: name, events, size, expiry date and title
ember list -l          # the same, with each link
ember rm NAME          # remove one bundle (or several: ember rm NAME1 NAME2)
```

`ember list` and `ember rm` take `--site` and `--url` too. If you have published nothing, `ember list` says so.

A site's cron job removes a bundle **30 days** after you last published it.

Other people's bundles are not listed anywhere. You reach them only through a link. After you open someone's link,
it appears under **Recent**.

### Publish from outside lxplus

On lxplus, EOS is mounted, so `ember` copies the bundle as a normal file. On other machines, `ember` copies it with
XRootD (`xrdcp` and `xrdfs`). For this you need:

- the XRootD tools in your `PATH`: run `cmsenv` first;
- a valid Kerberos ticket: run `kinit <your login>@CERN.CH`.

### Publish when your account name is not your CERN login

`ember` publishes to the user area named after your account on the machine you are on. The viewer looks for your files
under your CERN login. If the two differ, give your CERN login:

```bash
ember FILE.root --user jsmith        # or: export EMBER_USER=jsmith
```

[The `ember` command](cli.md#environment-variables) has the details of every setting.
