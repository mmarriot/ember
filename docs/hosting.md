# Hosting the site

For whoever sets up and runs an evd site. A user needs none of this.

The site is a **static website**: a folder of files served over HTTPS behind the CERN sign-on, with no server
process and no database. Everything in it is written by commands: users' `evd FILE.root`, and two cron jobs. The
operating detail (configuration keys, what each pass does, how to redeploy) is in the repository's
[`service/README.md`](https://github.com/mmarriot/evd/blob/main/service/README.md); this page is the overview and
what has to be asked for.

> **Not set up yet.** The CMS site does not exist. `/eos/project/c/cms-evd/` and `https://cms-evd.web.cern.ch` are
> placeholders, set in one file (`evdtools/site.py`) and overridden by `EVD_SITE_DIR`, `EVD_SITE_URL` and
> `EVD_SERVICE_DIR`. Everything on this page marked **unverified** was worked out from the documentation of the
> CERN services and has not been run. The scripts themselves were run against a local directory and a test folder
> on EOS.

## Layout

```
/eos/project/c/cms-evd/
├── www/                      the site (EVD_SITE_DIR), served as https://cms-evd.web.cern.ch (EVD_SITE_URL)
│   ├── index.html, assets/   the viewer, built by service/deploy.sh
│   ├── index.json            the shared data sets, rewritten by `evd sync` (newest data first)
│   ├── whoami                answers {"login": "..."} for the signed-in person (optional, see below)
│   └── data/
│       ├── <campaign>/       shared groups: bundles and campaign.json (titles), written by `evd sync` / `evd publish`
│       └── u/<login>/        each user's bundles and index.json, written by that user's `evd`
├── bin/evd                   the command as one file, for users (EVD_BIN_DIR)
└── service/                  EVD_SERVICE_DIR
    ├── code/                 what cron runs: evdtools/, service/, pylib/, site.env
    ├── state/                lock/ while a sync runs, failures.json
    ├── logs/                 sync.log, clean.log
    └── cmssw/<release>/      CMSSW areas for the RelVal campaigns
```

A user's index is `{"updated", "bundles": [{"file", "title", "events", "size", "created", "expires"}]}`, newest
first, `file` relative to the site, so a link is `<EVD_SITE_URL>/#b=<file>`. The site's own `index.json` never lists
`data/u/`: a user's bundle is seen by its owner and by whoever has its link.

## What to ask for

A checklist for the request to CERN IT and CMS. All of it **unverified** until done.

1. **An EOS project space** (`/eos/project/c/cms-evd`), through the "Request project space on EOS/CERNBox" form
   ([CERNBox documentation](https://cernbox.docs.cern.ch/web/projects/requesting_for_project_space)). It comes with
   a `www` folder and admin, writer and reader groups. Size: see [Quota](#quota-and-retention).
2. **A service account** to own the site, the cron jobs and the files they write, so that the site does not hang on
   one person's account.
3. **A webEOS site** (`cms-evd`, or the name CMS prefers) serving `www/`, created in the Web Services Portal
   ([webEOS documentation](https://webeos.docs.cern.ch/create_site)). Sites are owned by primary accounts by
   default; a site owned by a service account needs a request to lift that.
4. **Access restricted to CMS members.** Keep the site's *Guest access* off (the default: every visitor signs on),
   and require a role: in the Application Portal, give the site's application a role mapped to the CMS members
   group, then either protect the whole site with that role or, with *Use .htaccess files* enabled, put in `www/`:
   ```apache
   AuthType openid-connect
   Require claim cern_roles:<role identifier>
   ```
   ([webEOS: authorization](https://webeos.docs.cern.ch/authorization)).
5. **Write access for CMS members under `data/u/`** (next section).
6. **acron** for the service account on lxplus ([acrontab documentation](https://acrontab.docs.cern.ch)).
7. Optionally, **CGI execution** on the site, for `whoami`.

## Users' areas and their access

`evd FILE.root` creates `data/u/<login>/` on first use and writes the bundle and the index there, either through the
mounted file system (lxplus) or through XRootD with the user's Kerberos ticket. So the EOS access rules of
`www/data/u/` must let:

- every CMS member create their own folder and write in it;
- the service account write and delete everywhere (it removes expired bundles and rewrites indexes);
- everyone who can open the site read (the web server's account included).

**Unverified:** the exact EOS ACL. The intent is an ACL on `data/u/` that grants the CMS members group write access
and is inherited by new folders, set by the project's administrators with `eos attr set sys.acl=...`; whether a
member can then be kept from deleting another member's files, and whether files a user writes count against the
project's quota, are questions for EOS support when the space is requested. What the scripts assume is only the three
points above. The login in the path is the account name on the machine that ran `evd` (`EVD_USER` overrides it), and
nothing checks it: the site trusts its members.

## Who is looking: `whoami`

The viewer lists a person's own files under **My files**. To know who is looking it asks the site for `whoami`
(relative to the page) and expects `{"login": "jsmith"}`. Any other answer, or none, is ignored: the viewer then asks
the person for their CERN login once and remembers it in the browser. The site works without `whoami`.

A minimal script, **untested** (it needs CGI execution enabled on the webEOS site, and the name of the variable in
which the sign-on passes the login has to be checked there):

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

with, in `www/.htaccess`, a rule that serves it at the address the viewer asks for:

```apache
RewriteEngine On
RewriteRule ^whoami$ cgi-bin/whoami.py [L]
```

## The cron jobs

Two entries in the service account's acrontab (step by step, with dry runs first, in
[`service/LXPLUS_SETUP.md`](https://github.com/mmarriot/evd/blob/main/service/LXPLUS_SETUP.md)):

```
*/15 * * * * lxplus.cern.ch <service>/code/service/run_sync.sh  >> <service>/logs/sync.log  2>&1
20 4 * * *   lxplus.cern.ch <service>/code/service/run_clean.sh >> <service>/logs/clean.log 2>&1
```

- **sync** (`evd sync`): for each campaign of `service/campaigns.json`, converts the input files that have no bundle
  yet (one per pass by default), then rewrites `index.json`. A lock keeps two passes apart; a file that fails three
  times is left alone until its entry is removed from `state/failures.json`.
- **clean** (`evd clean`): removes users' bundles published more than 30 days ago, files a publish left half-copied
  more than a day ago, and rewrites each user's index to list exactly the bundles present. It touches nothing outside
  `data/u/`. `evd clean --dry-run` lists what it would remove.

### Shared samples: RelVal campaigns

So that a new user has something to open with nothing to run, a campaign can take CMSSW reconstruction files. With
`"export"` in its entry, `sync` first makes the event-display NanoAOD of the first `max_events` events of each file
(`cmsDriver.py -s NANO:@EVD`, in a clean environment set up from the CMSSW area the entry names), then converts it:

```json
{ "name": "relval_CMSSW_20_1_0_pre6", "title": "RelVal CMSSW_20_1_0_pre6",
  "inputs": "/eos/cms/store/relval/CMSSW_20_1_0_pre6/RelVal*/GEN-SIM-RECO/*_D121_*/*/*.root",
  "xrootd": "root://eoscms.cern.ch/", "profile": "cms", "max_events": 10,
  "stem": "wildcards", "stem_parts": [0, 1, 2],
  "export": {"cmssw": "/eos/project/c/cms-evd/service/cmssw/CMSSW_20_1_0_pre6", "geometry": "D121"} }
```

One bundle of 10 events per sample, under the heading "RelVal CMSSW_20_1_0_pre6" in the viewer's list. A new release
is a new entry with its own CMSSW area (`cmsrel` once, in a release that has `NANO:@EVD`; until the flavour is
merged, with the topic branch merged in and built). **Unverified:** the path pattern is an example after the layout
of an earlier release, and no RelVal file has been through this under acron; the same code was run by hand on a
step3 file (39 s for 2 events, most of it the job starting).

## Deploying

From a clone, on a machine with node, python3 and the site's EOS space mounted, as the service account:

```bash
service/deploy.sh          # or: EVD_SITE_DIR=... EVD_SITE_URL=... EVD_SERVICE_DIR=... service/deploy.sh
```

It builds the viewer and copies it to the site (new assets first, `index.html` last, old assets after, so a visitor
never gets a page that points at missing files); copies `evdtools/` and `service/` to `code/` and records the site in
`code/site.env`; builds `evd` as one file and puts it in `bin/`. Deploying again is how the viewer, the converter and
the command are updated. Users with an alias to `bin/evd` get the new command at once; a bundle already published is
not touched (a bundle says how it is drawn, so old bundles keep working with a new viewer).

## Quota and retention

- A bundle is about 0.85 MB per event without pile-up and 18 MB per event at 200 pile-up; `evd` publishes 10 events
  by default, so a typical PU200 bundle is 180 MB. A hundred users each keeping five of those is 90 GB.
- Bundles expire 30 days after they were last published (`evd clean --days N`, or `EVD_KEEP_DAYS` for the cron job,
  changes it). **There is no quota per user**: one person can fill the space. If that happens, the directory sizes
  under `data/u/` say who.
- Shared groups do not expire. A RelVal campaign of 10 events per sample is of the same order per sample.
- The 1 TB that a project space gets by default is ample for a start.

## What each visitor costs

Per open page: `index.json` and the visitor's own index every 30 s while the tab is visible, and one ranged read per
event shown (0.85 to 18 MB). The web server only serves files; there is nothing to scale but EOS and the web
front end, which CERN IT runs.
