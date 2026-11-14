# Hosting the site

This page is for the people who set up and run an Ember site. Users do not need it.

The site is a **static website**: a folder of files, served over HTTPS behind the CERN single sign-on. There is no
server process and no database. Commands write everything in it: each user's `ember FILE.root`, and two cron jobs.

This page gives the overview, and what to ask CERN IT for. The operating details (configuration keys, what each pass
does, how to redeploy) are in the repository's
[`service/README.md`](https://github.com/mmarriot/ember/blob/main/service/README.md).

> **Not set up yet.** The CMS site does not exist. `/eos/project/c/cms-ember/` and `https://cms-ember.web.cern.ch` are
> placeholders. They are set in one file (`embertools/site.py`), and `EMBER_SITE_DIR`, `EMBER_SITE_URL` and
> `EMBER_SERVICE_DIR` override them. Everything marked **unverified** on this page comes from the documentation of the
> CERN services, and has not been tried. The scripts themselves were run against a local folder and a test folder on
> EOS.

## Layout

```
/eos/project/c/cms-ember/
├── www/                      the site (EMBER_SITE_DIR), served as https://cms-ember.web.cern.ch (EMBER_SITE_URL)
│   ├── index.html, assets/   the viewer, built by service/deploy.sh
│   ├── index.json            the shared data sets, rewritten by `ember sync` (newest data first)
│   ├── whoami                answers {"login": "..."} for the signed-in person (optional, see below)
│   └── data/
│       ├── <campaign>/       shared groups: bundles and campaign.json (titles), written by `ember sync` / `ember publish`
│       └── u/<login>/        each user's bundles and index.json, written by that user's `ember`
├── bin/ember                 the command as one file, for users (EMBER_BIN_DIR)
└── service/                  EMBER_SERVICE_DIR
    ├── code/                 what cron runs: embertools/, service/, pylib/, site.env
    ├── state/                lock/ while a sync runs, failures.json
    ├── logs/                 sync.log, clean.log
    └── cmssw/<release>/      CMSSW areas for the RelVal campaigns
```

A user's index has this form:

```
{"updated", "bundles": [{"file", "title", "events", "size", "created", "published", "expires"}]}
```

- The bundles are listed most recently published first.
- `file` is relative to the site, so a link is `<EMBER_SITE_URL>/#b=<file>`.
- `created` is when the bundle was converted, `published` when it was last put on the site, and `expires` is 30 days
  after `published`.

The site's own `index.json` never lists anything in `data/u/`. A user's bundle is seen only by its owner and by
whoever has its link.

## What to ask for

A checklist for the request to CERN IT and CMS. All of it is **unverified** until it is done.

1. **An EOS project space** (`/eos/project/c/cms-ember`), through the "Request project space on EOS/CERNBox" form
   ([CERNBox documentation](https://cernbox.docs.cern.ch/web/projects/requesting_for_project_space)). It comes with a
   `www` folder, and admin, writer and reader groups. For its size, see [Quota](#quota-and-retention).
2. **A service account** to own the site, the cron jobs and the files they write, so that the site does not depend
   on one person's account.
3. **A webEOS site** (`cms-ember`, or the name CMS prefers) that serves `www/`, created in the Web Services Portal
   ([webEOS documentation](https://webeos.docs.cern.ch/create_site)). By default a site is owned by a primary
   account. A site owned by a service account needs a request to lift this.
4. **Access for CMS members only.** Keep the site's *Guest access* off (the default: every visitor signs on), and
   require a role. In the Application Portal, give the site's application a role mapped to the CMS members group.
   Then either protect the whole site with that role, or enable *Use .htaccess files* and put this in `www/`:
   ```apache
   AuthType openid-connect
   Require claim cern_roles:<role identifier>
   ```
   ([webEOS: authorization](https://webeos.docs.cern.ch/authorization)).
5. **Write access for CMS members under `data/u/`** (next section).
6. **acron** for the service account on lxplus ([acrontab documentation](https://acrontab.docs.cern.ch)).
7. Optionally, **CGI execution** on the site, for `whoami`.

## Users' areas and their access

The first time a user runs `ember FILE.root`, it creates `data/u/<login>/`. It writes the bundle and the index there,
either through the mounted file system (lxplus) or through XRootD with the user's Kerberos ticket.

Set up these rights once on the site folder, with EOS ACLs:

- everyone who may see the site can read (the web server's account included);
- a CMS member can create their own folder under `data/u/` and write in it, **and in no one else's**;
- the service account that runs the cron jobs can write everywhere. It removes expired bundles and rewrites the
  lists.

**These rights are the only thing that keeps one user from replacing or removing another user's bundles.** `ember`
writes as whoever runs it, with their own EOS rights. The site has no server that could check anything. `--user` and
`EMBER_USER` name an area; they prove nothing.

What `ember` does check:

- a login and a bundle name are plain names, so that a path built from them stays inside `data/u/<login>/`. A login
  starts with a letter, followed by letters, digits, `-` and `_`, 2 to 32 characters in all, in lower case;
- `ember clean` leaves alone anything in `data/u/` that is a link.

**Unverified:** nobody has yet worked out or tried the ACL that gives exactly these rights on an EOS project space (a
folder that only its creator can write in, under a parent where every CMS member can create one, with deletion by the
service account), because the site does not exist yet. Whether files that a user writes count against the project's
quota is also a question for EOS support.

Before the site is announced, test with two ordinary accounts that neither can write, replace or remove anything in
the other's folder: `ember --user <the other> FILE.root`, `ember rm --user <the other> NAME`, and plain `cp` and `rm` on
the mounted folder. Check also that the cron account can.

## Who is looking: `whoami`

The viewer lists a person's own files under **My files**. To know who is looking, it asks the site for `whoami`
(relative to the page), and expects `{"login": "jsmith"}`. It ignores any other answer, or no answer. In that case
the viewer asks the person for their CERN login once, and remembers it in the browser. The site works without
`whoami`.

Here is a minimal script. It is **untested**: it needs CGI execution enabled on the webEOS site, and the name of the
variable in which the sign-on passes the login has to be checked there.

```python
#!/usr/bin/env python3
# www/cgi-bin/whoami.py: the signed-in person's CERN login, for the viewer's "My files".
import json, os, re

login = os.environ.get("OIDC_CLAIM_cern_upn") or os.environ.get("REMOTE_USER") or ""
login = login.split("@")[0].lower()
print("Content-Type: application/json")
print("Cache-Control: no-store")
print()
print(json.dumps({"login": login} if re.fullmatch(r"[a-z0-9_-]+", login) else {}))
```

In `www/.htaccess`, add a rule that serves it at the address the viewer asks for:

```apache
RewriteEngine On
RewriteRule ^whoami$ cgi-bin/whoami.py [L]
```

## The cron jobs

There are two entries in the service account's acrontab.
[`service/LXPLUS_SETUP.md`](https://github.com/mmarriot/ember/blob/main/service/LXPLUS_SETUP.md) sets them up step by
step, with dry runs first.

```
*/15 * * * * lxplus.cern.ch <service>/code/service/run_sync.sh  >> <service>/logs/sync.log  2>&1
20 4 * * *   lxplus.cern.ch <service>/code/service/run_clean.sh >> <service>/logs/clean.log 2>&1
```

- **sync** (`ember sync`), every 15 minutes. For each campaign of `service/campaigns.json`, it converts the input files
  that have no bundle yet (one per pass by default). Then it rewrites `index.json`. A lock keeps two passes apart. A
  file that fails three times is left alone until you remove its entry from `state/failures.json`.
- **clean** (`ember clean`), once a day. It removes:
  - users' bundles published more than 30 days ago;
  - files that a publish left half-copied more than a day ago.

  Then it rewrites each user's index, to list exactly the bundles present. It touches nothing outside `data/u/`, and
  nothing there that is a link. `ember clean --dry-run` lists what it would remove. `--days N` (1 or more) changes the
  30 days.

### Shared samples: RelVal campaigns

A new user should have something to open without running anything. For this, a campaign can take CMSSW
reconstruction files. With `"export"` in its entry, `sync` first makes the event-display NanoAOD of the first
`max_events` events of each file. It runs `cmsDriver.py -s NANO:@EVD` in a clean environment, set up from the CMSSW
area that the entry names. Then it converts the NanoAOD:

```json
{ "name": "relval_CMSSW_20_1_0_pre6", "title": "RelVal CMSSW_20_1_0_pre6",
  "inputs": "/eos/cms/store/relval/CMSSW_20_1_0_pre6/RelVal*/GEN-SIM-RECO/*_D121_*/*/*.root",
  "xrootd": "root://eoscms.cern.ch/", "profile": "cms", "max_events": 10,
  "stem": "wildcards", "stem_parts": [0, 1, 2],
  "export": {"cmssw": "/eos/project/c/cms-ember/service/cmssw/CMSSW_20_1_0_pre6", "geometry": "D121"} }
```

This makes one bundle of 10 events per sample, under the heading "RelVal CMSSW_20_1_0_pre6" in the viewer's list.

A new release is a new entry, with its own CMSSW area. Run `cmsrel` once, in a release that has `NANO:@EVD`. Until
the flavour is merged, merge in the topic branch and build it.

**Unverified:** the path pattern is an example, based on the layout of an earlier release. No RelVal file has been
through this under acron yet. The same code was run by hand on a step3 file: 39 s for 2 events, most of it for the
job to start.

## Deploying

From a clone, on a machine with node, python3 and the site's EOS space mounted, as the service account:

```bash
service/deploy.sh          # or: EMBER_SITE_DIR=... EMBER_SITE_URL=... EMBER_SERVICE_DIR=... service/deploy.sh
```

The script:

1. builds the viewer and copies it to the site: new assets first, then `index.html`, then it removes the old assets.
   So a visitor never gets a page that points at missing files;
2. copies `embertools/` and `service/` to `code/`, and records the site in `code/site.env`;
3. builds `ember` as one file, and puts it in `bin/`.

Deploying again is how you update the viewer, the converter and the command. Users with an alias to `bin/ember` get
the new command at once. Bundles already published are not touched. A bundle says how it is drawn, so old bundles
keep working with a new viewer.

**A site set up before the project was called Ember** keeps working after a deployment. Its bundles end in `.evdb`:
the viewer opens them, old links still work, `sync` does not convert their inputs again, and `clean` expires them.
New bundles end in `.ember`. Three things are not carried over: the environment variables are now `EMBER_*` (set
them in place of the `EVD_*` ones), the command is installed as `bin/ember` (remove the old `bin/evd`, or users of
it keep an old copy), and the old `code/evdtools/` is left in place (remove it).

## Quota and retention

- A bundle is about 0.85 MB per event without pile-up, and 18 MB per event at 200 pile-up. `ember` publishes 10 events
  by default, so a typical bundle at 200 pile-up is 180 MB. A hundred users who each keep five of those use 90 GB.
- Bundles expire 30 days after they were last published. `ember clean --days N`, or `EMBER_KEEP_DAYS` for the cron job,
  changes this.
- **There is no quota per user**: one person can fill the space. If that happens, the folder sizes under `data/u/`
  show who.
- Shared groups do not expire. A RelVal campaign of 10 events per sample takes about the same space per sample.
- The 1 TB that a project space gets by default is enough to start.

## What each visitor costs

Each open page reads `index.json` and the visitor's own index every 30 s while the tab is visible. It makes one
ranged read per event shown (0.85 to 18 MB). The web server only serves files. There is nothing to scale except EOS
and the web front end, which CERN IT runs.
