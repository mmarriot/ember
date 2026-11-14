"""embertools: make, check and publish .evdb event-display bundles (docs/format.md).

    __main__.py    the `ember` command
    nano.py        NanoAOD files -> a bundle: convert()
    converter.py   a profile resolved against a file's tables, which converts one event at a time
    profile.py     loading a profile; what its keys do: relations.py, derive.py (columns), display.py (layers)
    bundle.py      the bundle format: writer, reader and checks
    export.py      CMSSW reconstruction files -> event-display NanoAOD, with cmsDriver.py
    site.py        the site and the users' areas on it (ember view, list, rm, clean)
    service.py     the site's cron jobs: converting campaigns of files and the site's index
    runinfo.py     information about runs, from a JSON file or the run registry

This file imports nothing, so that `python3 -m embertools.site` runs without numpy (service/deploy.sh).
"""

__version__ = "0.2.0"


class Problem(Exception):
    """Something the user can act on (a wrong input, no access to the site, no CMSSW environment): the command line
    prints its text and nothing else."""
