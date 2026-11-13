# The `evd` command

One command for everything outside the browser: convert a file, publish it, list and remove what you published,
inspect a bundle, and run the site. `evd FILE.root` is `evd view FILE.root`.

```
evd FILE.root [...]          convert, publish to your area of the site, print the link     (evd view)
evd list                     your published bundles
evd rm NAME [...]            remove them
evd convert IN... -o OUT     NanoAOD to a bundle file, with every converter option          (alias: from-nano)
evd inspect B                summarise a bundle
evd validate B               check the structure of every event of a bundle
evd sync | publish | simulate | clean        the site's own commands (cron, operators)
evd --version                evd 0.2.0
```

How to get it is in [Getting started](getting-started.md#the-evd-command). `python3 -m evdtools ...` from a clone is
the same command. `-h` after any command prints its options.

> The site's address and directory (`https://cms-evd.web.cern.ch`, `/eos/project/c/cms-evd/www`) are provisional:
> the CMS site is not set up yet. `--site`, `--url` and the [environment variables](#environment-variables) point the
> command at another site.

## `evd view`

```
evd [view] FILE.root [FILE.root ...] [options]
```

Checks that the site is there and your area writable (before any work: an export takes minutes), converts the
inputs to one bundle, copies it to `data/u/<login>/<name>.evdb` on the site, adds it to your list and
prints the link on the last line, after an empty line (so `evd FILE.root | tail -1` is the link). Options may come
before or after the files: `evd -o out.evdb FILE.root` is `evd FILE.root -o out.evdb`.

The inputs are either NanoAOD files written with `NANO:@EVD`, or CMSSW reconstruction files (step3: event content
`FEVTDEBUGHLT` or `RECOSIM`). For reconstruction files `evd` first runs `cmsDriver.py ... -s NANO:@EVD` in a temporary directory,
which needs `cmsenv` in a release that has the flavour ([CMSSW side](cmssw.md)). The two kinds cannot be mixed in one
call.

| option | meaning |
|---|---|
| `-o FILE.evdb`, `--output` | write the bundle to this file and publish nothing |
| `--no-publish` | write `<name>.evdb` in the current directory and publish nothing |
| `--name NAME` | the bundle's name on the site and in the link. Default: the first input's file name without extension. Letters, digits, `.`, `_` and `-` |
| `--title TITLE` | its title in the viewer's list. Default: the name. The list adds "· N events" |
| `--profile PROFILE` | a built-in profile or the path of a JSON file ([Profiles](profiles.md)). Default: `cms` |
| `--max-events N` | at most N events. Default: 10; with `--events`, all of those asked for. `0`: all |
| `--events 3,7-9` | only these event numbers (the profile's event selection still applies). A reconstruction file is exported in full to find them |
| `-j N`, `--threads` | threads to read and compress with. Default: up to 4, never more than the process may use |
| `--site DIR`, `--url URL`, `--user LOGIN` | the site's directory and address, and whose area. A login is a letter, then letters, digits, `-` and `_`, 2 to 32 characters; it is made lower case. Default: the environment variables below, else the CMS site and your login |

For reconstruction files:

| option | meaning |
|---|---|
| `--geometry G` | `D110`, `Run4D110` or `ExtendedRun4D110`. Default: read from the file, by matching the geometry files its job used with the release's Run4 geometries |
| `--era E` | e.g. `Phase2C17I13M9`. Default: the release's era for that geometry (a file does not record its era) |
| `--conditions C` | a global tag, e.g. `auto:phase2_realistic_T33`. Default: the file's, if it names exactly one; else the release's for that geometry |
| `--nano FILE.root` | also keep the NanoAOD that was made |

A bundle is kept 30 days after it was last published; the same name again replaces it, renews it and keeps its link.

## `evd list`, `evd rm`

```
evd list [-l]                 name, events, size, expiry and title of each of your bundles; -l adds its link
evd rm NAME [NAME ...]        remove them; exit code 1 if one of them does not exist
```

Both take `--site`, `--url` and `--user`, and both end with exit code 1 when the site is not there or cannot be
reached. With nothing published, `evd list` prints `<login> has no published bundle` and exits 0. The list is in
the order of publishing, most recent first.

## `evd convert`, `evd inspect`, `evd validate`

```
evd convert IN.root [IN2.root ...] -o OUT.evdb [--profile hgcal] [--max-events N] [--events ...] [-j N]
            [--sorted] [--run-tables FILE] [--run-info SPEC]
evd inspect OUT.evdb          tables, relations, layers, record sizes, first events, release and converter
evd validate OUT.evdb         structural checks of every record; exit code 1 on problems
```

`convert` is the converter alone, for any NanoAOD and any profile: it converts every event unless told otherwise, and
its default profile is `hgcal`. Its further options (`--sorted`, `--run-tables`, `--run-info`) are described with the
converter in [Profiles](profiles.md#command-line). For CMS events, `evd FILE.root -o OUT.evdb` is the shorter way.

## Site commands

For whoever runs the site ([Hosting](hosting.md)); a user does not need them.

```
evd sync --config campaigns.json [--max-files N] [--dry-run]      convert new files of the campaigns, rewrite the index
evd publish B.evdb --campaign X --title T [--name N] [--file-title T] [--site DIR]    add a bundle to a shared group
evd simulate SRC.evdb [--campaign C] [--events N] [--interval S]  publish a bundle a few events at a time (Live demo)
evd clean [--days 30] [--dry-run] [--site DIR]                    remove users' bundles past their 30 days
```

`clean --days` takes a whole number of 1 or more (anything else is a usage error, exit code 2), runs only where the
site is a mounted directory, and leaves alone anything under `data/u/` that is a link.

## Environment variables

| variable | meaning | default |
|---|---|---|
| `EVD_SITE_DIR` | the site's directory: a mounted path, an `/eos/...` path (reached through XRootD where it is not mounted) or a `root://host//path` URL | `/eos/project/c/cms-evd/www` (provisional) |
| `EVD_SITE_URL` | the address the site is served at; only used to print links | `https://cms-evd.web.cern.ch` (provisional) |
| `EVD_USER` | whose area you publish to | your login on this machine |
| `EVD_SERVICE_DIR` | the site's service directory (state of `sync`) | `/eos/project/c/cms-evd/service` (provisional) |
| `EVD_DEBUG=1` | print the Python traceback of a failure instead of one line | off |

On a machine where your account name is not your CERN login, set `EVD_USER` (or `--user`) to the CERN login: the
viewer finds your files under it. Nothing checks that the login is yours: what keeps one person out of another's
area is the access rights of the folders on the site ([Hosting](hosting.md#users-areas-and-their-access)).

## Exit codes

| code | meaning |
|---|---|
| 0 | done |
| 1 | a problem, said in one line on standard error that starts with `evd:` (also `validate` when it finds problems) |
| 2 | wrong usage (unknown option, missing argument) |
| 130 | interrupted (Ctrl-C) |

## Messages, and what to do

| `evd: ...` | what to do |
|---|---|
| `FILE: no such file` | check the path; `root://` URLs are read too |
| `FILE: cannot be read as a ROOT file (...)` | the input is not a ROOT file; a `.evdb` bundle is already converted: open it in the viewer, or `evd inspect` it |
| `FILE: no Events tree ...`, `... neither NanoAOD ... nor CMSSW EDM` | the file is neither kind of input |
| `FILE has none of the tables that the profile cms draws (it has: Jet, Muon, ...)` | this is analysis NanoAOD, not the event-display one. Make the input with `NANO:@EVD` ([CMSSW side](cmssw.md)), or give a `--profile` written for this file |
| `display T: no column C; it has: ...` | the file has table `T` without a column the profile draws: the file and the profile are of different versions. Use the `evd` that goes with the release that wrote the file (`evd inspect` and the first line of `evd view` name the release) |
| `the inputs mix NanoAOD and CMSSW reconstruction files` | give one kind per call |
| `no event was converted` | `--events` named events the file does not have, or the profile's selection kept none |
| `'NAME' cannot be a bundle name` | give `--name` with letters, digits, `.`, `_`, `-` |
| `'X' cannot be a login: a letter, then letters, digits, '-' and '_', 2 to 32 characters` | your account name here is not a CERN login: give yours with `--user` or `EVD_USER` |
| `the site directory DIR does not exist` (also `... on root://HOST/`) | you are not where the site is mounted and the path is not on EOS, or the site is not set up; set `EVD_SITE_DIR`/`--site`, or write a file with `-o`. `view`, `list` and `rm` all stop here, before any work |
| `cannot write to DIR: Permission denied ...` | the users' areas are writable by CMS members; with `-o FILE` the bundle is written here instead |
| `cannot write PATH: root://... refused (...)` | no valid Kerberos ticket: `kinit <login>@CERN.CH`, then again |
| `xrdcp not found ...` | the site is not mounted on this machine and XRootD is not in `PATH`: run `cmsenv` first |
| `this is a CMSSW reconstruction file: ... run cmsenv ...` | a step3 file needs a CMSSW environment with `NANO:@EVD`: `cmsenv` in such a release, then again |
| `cmsDriver.py not found: run cmsenv first` | as above |
| `FILE: cannot tell which geometry it was made with (...)` | give `--geometry`, e.g. `--geometry D110` |
| `this release has no default for geometry G; give --era and --conditions` | give them |
| `this CMSSW release has no NANO:@EVD. The event-display NanoAOD is the package DPGAnalysis/EventDisplayNanoAOD ...` | the CMSSW area lacks the flavour: add it as [Getting started](getting-started.md#before-you-start) says, or use a release that has it, then `cmsenv` and again |
| `the export job failed (exit code N); the end of its output (all of it: FILE): ...` | the cmsRun job failed; its last lines follow and the whole log is kept in the file named. A wrong era or conditions for the file ends here: give `--era`, `--conditions` |
| `LOGIN has no bundle named NAME (evd list)` | `evd list` shows the names |
| `argument --days: 'N' is not a whole number of 1 or more` (`evd clean`) | give at least 1 |
| `no profile P: neither a file nor one of the built-in profiles (...)` | the built-in ones are listed in the message |

Anything else is a bug: run again with `EVD_DEBUG=1` and report the traceback
([issues](https://github.com/mmarriot/evd/issues)).

## What it does on the machine

- **Converting** reads the NanoAOD in chunks of about 100 MB with uproot (baskets decompressed on the thread pool),
  builds each event's tables and relations with numpy, and compresses each event's record with zlib on the same
  pool. At 200 pile-up a record is about 110 MB before compression: compressing the records and decompressing
  the input are most of the work, and both are spread over the threads. Peak memory follows the read chunk and
  the records waiting to be written: about 2 GB at 200 pile-up with 4 threads, 0.7 GB without pile-up. Measured:
  50 events without pile-up in 4 s, 200 pile-up at 1.2 s per event (4 threads).
- **Publishing** copies the bundle under a temporary name and renames it, then does the same for your `index.json`,
  so a reader never sees half a file. Where the site is not mounted, each of these is an `xrdcp` or `xrdfs` call.
- **A reconstruction file** adds one cmsRun job: about 20 s to start, then 0.3 s per event without pile-up and 1.6 s
  at 200 pile-up (8 threads), most of it CMSSW's own truth association.
