#!/usr/bin/env python3
"""Build `ember` as one executable file: the embertools package (code and profiles) in a zip that python runs.

    python3 tools/build_zipapp.py [output, default dist/ember]

The file needs python3 (3.9 or later) with numpy and uproot, which every CMSSW environment has: `./ember FILE.root`
after cmsenv, with nothing to install.
"""

import os
import shutil
import sys
import tempfile

if sys.version_info < (3, 7):
    sys.exit(
        "build_zipapp.py needs Python 3.7 or later, and this python3 is %d.%d: run it after cmsenv or in an LCG "
        "view" % sys.version_info[:2]
    )
import zipapp  # after the check: older versions lack what is used below

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = "import sys\n\nfrom embertools.__main__ import main\n\nsys.exit(main())\n"


def build(output):
    with tempfile.TemporaryDirectory() as staging:
        shutil.copytree(
            os.path.join(REPO, "embertools"),
            os.path.join(staging, "embertools"),
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        with open(os.path.join(staging, "__main__.py"), "w") as f:
            f.write(MAIN)
        os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
        zipapp.create_archive(staging, output, interpreter="/usr/bin/env python3", compressed=True)
    return output


if __name__ == "__main__":
    print(build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "dist", "ember")))
