"""evdtools: produce, check and publish .evdb event-display bundles (docs/format.md)."""
__version__ = "0.2.0"


class Problem(Exception):
    """Something the user can act on (a wrong input, no access to the site, no CMSSW environment): the command line
    prints its text and nothing else."""
