# How-to guides

Short recipes for common tasks. Each one assumes that you have done [Getting started](getting-started.md) once. Every
option is listed in [The `evd` command](cli.md).

## Look at the shared samples

Open the site, `https://cms-evd.web.cern.ch` (provisional), and sign on with your CERN account. It opens the newest
shared data set.

To open another one, click the button at the left of the top bar. It shows the name of the data set that is open.
The data set chooser lists:

- the site's **shared groups**: a few events of each RelVal sample of recent releases, and test-stand data. The site
  keeps them up to date ([Hosting](hosting.md)).
- **My files**: the bundles you published.
- **Recent**: the data sets you opened from someone's link.

Type to filter the list. Use ↑ ↓ and Enter to open a data set, and Esc to close the chooser.

## Convert a step3 file you already have

You need `cmsenv` in a release that has `NANO:@EVD` ([Getting started](getting-started.md#what-you-need)). Then:

```bash
evd step3.root
```

`evd` first runs `cmsDriver.py ... -s NANO:@EVD` in a temporary folder to make the NanoAOD. Then it converts and
publishes as usual. It tells you which settings it used:

- **geometry:** read from the file. `evd` matches the list of geometry files that the job used with the release's
  Run4 geometries.
- **conditions:** the file's global tag, if the file names exactly one. Otherwise the release's default for that
  geometry.
- **era:** the release's default for that geometry. A file does not record its era.

If `evd` cannot tell, or if the file was made with other settings than these defaults, give them yourself:

```bash
evd step3.root --geometry D110 --era Phase2C17I13M9 --conditions auto:phase2_realistic_T33
```

To also keep the NanoAOD that `evd` made, add `--nano evd_nano.root`.

**Which files work:** files with event content `FEVTDEBUGHLT` (RelVal `GEN-SIM-RECO` files have it) or `RECOSIM`.
`AODSIM` and MiniAOD do not have the hits, so they do not work.

**How long it takes:** about 20 s for the job to start, then about 0.3 s per event without pile-up, or 1.6 s per
event at 200 pile-up (8 threads).

**The same by hand.** If you want the NanoAOD as a file of its own, run the step yourself, then `evd` on its output:

```bash
cmsDriver.py evd -s NANO:@EVD --conditions auto:phase2_realistic_T35 --geometry ExtendedRun4D104 \
    --era Phase2C22I13M9 --mc --eventcontent NANOAODSIM --datatier NANOAODSIM -n -1 --nThreads 8 \
    --filein file:step3.root --fileout file:evd_nano.root
evd evd_nano.root
```

Use the conditions, geometry and era of your file. This is also the way to pass options that `evd` does not pass,
such as `--procModifiers`.

## Choose which events, and how many

By default `evd` converts the first 10 events. A 200 pile-up event is about 18 MB to download, so a bundle of 10
such events is about 180 MB.

| option | effect |
| --- | --- |
| `--max-events 50` | the first 50 events |
| `--max-events 0` | all events |
| `--events 3,7-9` | only these event numbers (the `event` of each event, not its position in the file) |

With `--events`, every event you ask for is converted. For a step3 file, `--events` makes the NanoAOD of the whole
file first, to find them.

## Give your bundle a name and a title

By default the bundle takes the name of the first input file, without its extension. The name is part of the link.
The title is what the viewer shows in its lists.

```bash
evd step3_inNANOAODSIM.root --name ttbar_newtune --title "ttbar, new tune"
```

A name starts with a letter or a digit. It can then hold letters, digits, `.`, `_` and `-`.

Publishing again under the same name replaces the bundle. The link stays the same, and the 30 days start again.

## Manage your published bundles

**In the viewer:** open the data set chooser and look under **My files**. It lists your bundles, the most recently
published first, with the number of events and the date each one expires.

**In the shell:**

```bash
evd list             # your bundles: name, events, size, expiry date and title
evd list -l          # the same, with each link
evd rm NAME          # remove one bundle (or several: evd rm NAME1 NAME2)
```

If you have published nothing, `evd list` says so.

The site keeps a bundle for **30 days** after you last published it. Then the site removes it.

Other people's bundles are not listed anywhere. You reach them only through a link. After you open someone's link,
it appears under **Recent**.

## Keep a bundle to yourself

Nothing has to go to the site. Write the bundle to a file:

```bash
evd step3_inNANOAODSIM.root -o mine.evdb     # writes mine.evdb
evd step3_inNANOAODSIM.root --no-publish     # writes step3_inNANOAODSIM.evdb in this folder
```

To look at it, drop the file on the viewer's page, or click **Open a local file…** at the bottom of the data set
chooser. Your browser reads the file where it is. It is not uploaded. So it has no link, and the share button says
so.

Two commands describe and check a bundle without a browser:

```bash
evd inspect mine.evdb      # what it holds: layers, relations, sizes, the first events
evd validate mine.evdb     # checks the structure of every event
```

## Look at a bundle without the site

Write the bundle to a file with `-o FILE.evdb`, as above. Then drop it on any page of the viewer.

Until the CMS site exists, you need to run a viewer yourself. In a clone of the repository, with Node 18 or later:

```bash
cd viewer && npm ci && npm run dev      # then open http://127.0.0.1:5173
```

[CONTRIBUTING](https://github.com/mmarriot/evd/blob/main/CONTRIBUTING.md) says how to list bundles on this
development server.

## Publish from outside lxplus

On lxplus, EOS is mounted, so `evd` copies the bundle as a normal file. On other machines, `evd` copies it with
XRootD (`xrdcp` and `xrdfs`). For this you need:

- the XRootD tools in your `PATH`: run `cmsenv` first;
- a valid Kerberos ticket: run `kinit <your login>@CERN.CH`.

## Publish when your account name is not your CERN login

`evd` publishes to the user area named after your account on the machine you are on. The viewer looks for your files
under your CERN login. If the two differ, give your CERN login:

```bash
evd FILE.root --user jsmith        # or: export EVD_USER=jsmith
```

## Use another site

The commands `evd`, `evd list` and `evd rm` take `--site DIR` and `--url URL`. The environment variables
`EVD_SITE_DIR` and `EVD_SITE_URL` do the same for every command. Use them for a test site, or for a site run by
another group. [The `evd` command](cli.md#environment-variables) has the details.
