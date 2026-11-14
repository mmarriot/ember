# The `ember` command

`ember` does everything outside the browser. It converts a file, publishes it, lists and removes what you published,
inspects a bundle, and runs the site. `ember FILE.root` is short for `ember view FILE.root`.

```
ember FILE.root [...]          convert, publish to your user area, print the link     (same as ember view)
ember list                     list your published bundles
ember rm NAME [...]            remove published bundles
ember convert IN... -o OUT     convert NanoAOD to a bundle file, with every converter option   (old name: from-nano)
ember inspect B                summarise a bundle
ember validate B               check the structure of every event of a bundle
ember sync | publish | simulate | clean        commands for the people who run the site
ember --version                print the version: ember 0.2.0
```

[Getting started](getting-started.md#step-1-get-the-ember-command) explains how to get `ember`. From a clone,
`python3 -m embertools ...` is the same command. Add `-h` after any command to list its options.

> The site's address and directory (`https://cms-ember.web.cern.ch`, `/eos/project/c/cms-ember/www`) are provisional,
> because the CMS site is not set up yet. `--site`, `--url` and the [environment variables](#environment-variables)
> point `ember` at another site.

## `ember view`

```
ember [view] FILE.root [FILE.root ...] [options]
```

`ember view` does these steps in order:

1. It checks that the site is there and that your user area can be written. It does this before any other work,
   because making the NanoAOD of a step3 file takes minutes.
2. It converts all the input files to one bundle.
3. It copies the bundle to `data/u/<login>/<name>.ember` on the site, and adds it to your list there. A bundle of
   that name is replaced, including one published as `<name>.evdb` before the project was called Ember (old links to the
   `.evdb` file then open the new `.ember` one).
4. It prints an empty line, then the link on the last line. So `ember FILE.root | tail -1` gives you just the link.

Options can come before or after the files: `ember -o out.ember FILE.root` is the same as
`ember FILE.root -o out.ember`.

The input files are either:

- event-display NanoAOD files, written with `NANO:@EVD`; or
- CMSSW reconstruction files (step3), with event content `FEVTDEBUGHLT` or `RECOSIM`. For these, `ember` first runs
  `cmsDriver.py ... -s NANO:@EVD` in a temporary folder. This needs `cmsenv` in a release that has the `NANO:@EVD`
  step ([CMSSW side](cmssw.md)).

You cannot mix the two kinds in one call.

| option | meaning |
|---|---|
| `-o FILE.ember`, `--output` | write the bundle to this file, and publish nothing |
| `--no-publish` | write `<name>.ember` in the current folder, and publish nothing |
| `--name NAME` | the bundle's name on the site and in the link. Default: the first input's file name, without its extension. A name starts with a letter or a digit, followed by letters, digits, `.`, `_` and `-`. |
| `--title TITLE` | the bundle's title in the viewer's lists. Default: its name. The list adds "· N events". |
| `--profile PROFILE` | a built-in profile, or the path of a JSON file ([Profiles](profiles.md)). Default: `cms`. |
| `--max-events N` | convert at most N events. Default: 10, or, with `--events`, all of the events asked for. `0` means all. |
| `--events 3,7-9` | convert only these event numbers. The profile's event selection still applies. For a step3 file, `ember` makes the NanoAOD of the whole file to find them. |
| `-j N`, `--threads` | the number of threads that read and compress. Default: up to 4, and never more than the process may use. For a step3 file, also the number of threads of the cmsRun job (default: 4). |
| `--site DIR`, `--url URL`, `--user LOGIN` | the site directory, the site's address, and whose user area. Default: the [environment variables](#environment-variables), or else the CMS site and your login. A login starts with a letter, followed by letters, digits, `-` and `_`, 2 to 32 characters in all. `ember` makes it lower case. |

Options for CMSSW reconstruction files only:

| option | meaning |
|---|---|
| `--geometry G` | `D110`, `Run4D110` or `ExtendedRun4D110`. Default: read from the file, by matching the geometry files its job used with the release's Run4 geometries. |
| `--era E` | for example `Phase2C17I13M9`. Default: the release's era for that geometry. A file does not record its era. |
| `--conditions C` | a global tag, for example `auto:phase2_realistic_T33`. Default: the file's global tag, if it names exactly one; else the release's default for that geometry. |
| `--nano FILE.root` | also keep the NanoAOD that `ember` made, as this file |

If you give these options for a NanoAOD input, `ember` ignores them and says so.

The site keeps a bundle for 30 days after it was last published. Publishing the same name again replaces the
bundle, starts the 30 days again and keeps the same link. `ember` then says `replaced` instead of `published`.

## `ember list`, `ember rm`

```
ember list [-l]                 your bundles: name, events, size, expiry date and title; -l adds each link
ember rm NAME [NAME ...]        remove these bundles
```

`ember list` shows the most recently published bundle first. If you have published nothing, it prints
`<login> has no published bundle (ember FILE.root publishes one)` and exits with code 0.

`ember rm` exits with code 1 if one of the names does not exist. A name can be given with or without its extension.

Bundles you published before the project was called Ember end in `.evdb`. They are still listed, linked, removed and
expire like the others.

Both commands take `--site`, `--url` and `--user`. Both exit with code 1 when the site is not there or cannot be
reached.

## `ember convert`, `ember inspect`, `ember validate`

```
ember convert IN.root [IN2.root ...] -o OUT.ember [--profile hgcal] [--max-events N] [--events ...] [-j N]
              [--sorted] [--run-tables FILE] [--run-info SPEC]
ember inspect OUT.ember          layers, relations, record sizes, the largest tables of the first events,
                                 the CMSSW release and the converter
ember validate OUT.ember         check the structure of every record; exit code 1 if there are problems
```

`ember convert` is the converter alone. It works on any NanoAOD with any profile. Unlike `ember view`, it converts every
event unless you say otherwise, its default profile is `hgcal`, and it does not accept step3 files. Its extra options
(`--sorted`, `--run-tables`, `--run-info`) are described in [Profiles](profiles.md#command-line). For CMS events,
`ember FILE.root -o OUT.ember` is the shorter way. `ember inspect` and `ember validate` read any bundle, whether its
name ends in `.ember` or in the older `.evdb`.

## Site commands

These are for the people who run the site ([Hosting](hosting.md)). Users do not need them.

```
ember sync --config campaigns.json [--max-files N] [--dry-run]       convert new files of the campaigns, rewrite the index
ember publish B.ember --campaign X --title T [--name N] [--file-title T] [--site DIR]    add a bundle to a shared group
ember simulate SRC.ember [--campaign C] [--events N] [--interval S]  publish a bundle a few events at a time (Live demo)
ember clean [--days 30] [--dry-run] [--site DIR]                     remove users' bundles older than 30 days
```

`ember clean`:

- `--days` takes a whole number of 1 or more. Anything else is a usage error (exit code 2).
- It runs only where the site is a mounted directory.
- It leaves alone anything under `data/u/` that is a link.

## Environment variables

| variable | meaning | default |
|---|---|---|
| `EMBER_SITE_DIR` | the site directory: a mounted path, an `/eos/...` path (reached through XRootD where it is not mounted), or a `root://host//path` URL | `/eos/project/c/cms-ember/www` (provisional) |
| `EMBER_SITE_URL` | the site's address; used only to print links | `https://cms-ember.web.cern.ch` (provisional) |
| `EMBER_USER` | whose user area you publish to | your login on this machine |
| `EMBER_SERVICE_DIR` | the site's service directory (where `sync` keeps its state) | `/eos/project/c/cms-ember/service` (provisional) |
| `EMBER_DEBUG` | set to any value (even `0`) to print the Python traceback of a failure, instead of one line | not set |

These were called `EVD_SITE_DIR`, `EVD_SITE_URL`, `EVD_USER`, `EVD_SERVICE_DIR` and `EVD_DEBUG` before the project was
called Ember. The old names are no longer read: if one is set and its new name is not, `ember` stops and says which
to rename, so that an old `EVD_USER` cannot publish to another area unnoticed.

If your account name on this machine is not your CERN login, set `EMBER_USER` (or `--user`) to your CERN login. The
viewer looks for your files under that login.

Nothing checks that the login is really yours. Only the access rights of the folders on the site keep one person
out of another person's user area ([Hosting](hosting.md#users-areas-and-their-access)).

## Exit codes

| code | meaning |
|---|---|
| 0 | done |
| 1 | a problem, described in one line on standard error that starts with `ember:`. `ember validate` also exits with 1 when it finds problems. |
| 2 | wrong usage, for example an unknown option or a missing argument |
| 130 | interrupted (Ctrl-C) |

## Messages, and what to do

Each message below follows `ember: ` at the start of the line, except the usage error of `ember clean --days`, which
argparse prints as `ember clean: error: ...` (exit code 2).

| message | what to do |
|---|---|
| `FILE: no such file` | Check the path. `ember` can also read `root://` URLs. |
| `FILE: cannot be read as a ROOT file (...)` | The input is not a ROOT file. A `.ember` bundle is already converted: open it in the viewer, or run `ember inspect` on it. |
| `FILE: no Events tree ...`, `... neither NanoAOD ... nor CMSSW EDM` | The file is neither kind of input. |
| `FILE has none of the tables that the profile cms draws (it has: Jet, Muon, ...)` | This is analysis NanoAOD, not the event-display NanoAOD. Make the input with `NANO:@EVD` ([CMSSW side](cmssw.md)), or give a `--profile` written for this file. |
| `display T: no column C; it has: ...` | The file has table `T`, but without a column that the profile draws: the file and the profile come from different versions. Use the `ember` that goes with the release that wrote the file. `ember inspect` and the first line of `ember view` name the release. |
| `the inputs mix NanoAOD and CMSSW reconstruction files` | Give one kind of file per call. |
| `no event was converted` | `--events` named events that the file does not have, or the profile's selection kept none. |
| `'NAME' cannot be a bundle name` | Give a `--name` that starts with a letter or a digit, followed by letters, digits, `.`, `_` and `-`. |
| `'X' cannot be a login: a letter, then letters, digits, '-' and '_', 2 to 32 characters` | Your account name here is not a CERN login. Give your CERN login with `--user` or `EMBER_USER`. |
| `the site directory DIR does not exist` (or `... on root://HOST/`) | Either the site is not mounted here and the path is not on EOS, or the site is not set up. Set `EMBER_SITE_DIR` or `--site`, or write a file with `-o`. `view`, `list` and `rm` all stop here, before doing any work. |
| `cannot write to DIR: Permission denied ...` | Only CMS members can write to the user areas. With `-o FILE`, `ember` writes the bundle here instead. |
| `cannot reach DIR: root://... refused (...)`, or `cannot write PATH: root://... refused (...)` | You have no valid Kerberos ticket. Run `kinit <login>@CERN.CH`, then try again. |
| `xrdfs not found ...` (or `xrdcp`) | The site is not mounted on this machine, and the XRootD tools are not in your `PATH`. Run `cmsenv` first. |
| `this is a CMSSW reconstruction file: ... run cmsenv ...` | A step3 file needs a CMSSW environment with `NANO:@EVD`. Run `cmsenv` in such a release, then try again. |
| `cmsDriver.py not found: run cmsenv first` | The same as above. |
| `FILE: cannot tell which geometry it was made with (...)` | Give `--geometry`, for example `--geometry D110`. |
| `this release has no default for geometry G; give --era and --conditions` | Give `--era` and `--conditions`. |
| `this CMSSW release has no NANO:@EVD. The event-display NanoAOD is the package DPGAnalysis/EventDisplayNanoAOD ...` | Your CMSSW area lacks the `NANO:@EVD` step. Add it as [Getting started](getting-started.md#what-you-need) says, or use a release that has it. Then run `cmsenv` and try again. |
| `the export job failed (exit code N); the end of its output (all of it: FILE): ...` | The cmsRun job failed. Its last lines follow, and the whole log is kept in the file named. A wrong era or wrong conditions for the file end here: give `--era` and `--conditions`. |
| `LOGIN has no bundle named NAME (ember list)` | `ember list` shows your bundles' names. |
| `argument --days: 'N' is not a whole number of 1 or more` (`ember clean`) | Give 1 or more. |
| `no profile P: neither a file nor one of the built-in profiles (...)` | The message lists the built-in profiles. |

Any other message is a bug. Run the command again with `EMBER_DEBUG=1`, and report the traceback in the
[issue tracker](https://github.com/mmarriot/ember/issues).

## What it does on the machine

- **Converting.** `ember` reads the NanoAOD with uproot, in chunks of about 100 MB. A pool of threads decompresses the
  input. numpy builds each event's tables and relations. The same thread pool compresses each event's record with
  zlib. At 200 pile-up a record is about 110 MB before compression. Compressing the records and decompressing the
  input are most of the work, and both are spread over the threads. Peak memory depends on the read chunk and on
  the records that wait to be written: about 2 GB at 200 pile-up with 4 threads, and 0.7 GB without pile-up.
- **Publishing.** `ember` copies the bundle under a temporary name, then renames it. It does the same for your
  `index.json`. So a reader never sees half a file. Where the site is not mounted, each of these steps is one `xrdcp`
  or `xrdfs` call.
- **A step3 file** adds one cmsRun job. With 8 threads (`-j 8`; the default is 4) it took about 20 s to start, then
  0.3 s per event without pile-up, or 1.6 s per event at 200 pile-up. Most of this time is CMSSW's own truth
  association.

**Measured sizes and times**, per event, on ttbar events with geometry `ExtendedRun4D104` and the integration build
CMSSW_20_1_X_2026-11-12-2300:

| per event | no pile-up | 200 pile-up |
|---|---|---|
| NanoAOD (`NANO:@EVD`) | 0.94 MB | 21.5 MB |
| making it from a step3 file, 8 threads | 0.3 s | 1.6 s |
| bundle (`.ember`) | 0.85 MB | 18 MB |
| `ember`: NanoAOD to bundle, 4 threads | 0.1 s | 1.2 s |

Converting 50 events without pile-up took 4 s in all (4 threads).
