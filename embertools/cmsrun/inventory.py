"""What the release and the input have: the release's module plugins and the input's products."""

from collections import namedtuple

from .. import Problem

Product = namedtuple("Product", "type module instance process")


def plugins(prefix=(), env=None):
    """The names of the module plugins (EDProducers and others) of the CMSSW release that `prefix` / `env` set up
    (see export._environment): those of edmPluginDump's "CMS EDM Framework Module" category."""
    from ..export import cmssw_output

    names = module_plugins(cmssw_output([*prefix, "edmPluginDump", "-a"], env, "listing the release's plugins"))
    if not names:
        raise Problem("edmPluginDump lists no module plugins: run cmsenv in this shell, in a CMSSW release area")
    return names


def module_plugins(dump):
    """The module plugin names in the output of `edmPluginDump -a` (a "Category <name>:" line, then each plugin's
    name indented by two spaces and its library by three)."""
    names, inside = set(), False
    for line in dump.splitlines():
        if line.startswith("Category "):
            inside = line == "Category CMS EDM Framework Module:"
        elif inside and line.startswith("  ") and not line.startswith("   "):
            names.add(line.strip())
    return names


def is_product(branch):
    """Whether an Events branch holds a product: <type>_<module>_<instance>_<process>. (none of the four has an
    underscore; other branches, such as EventAuxiliary, have none)."""
    return len(branch.rstrip(".").split("_")) == 4


def products(branches):
    """The products of an EDM file from the names of its Events branches (is_product)."""
    return [Product(*b.rstrip(".").split("_")) for b in branches if is_product(b)]


class Inventory:
    """What the input holds, by module label and instance (of any process: the HLT's own products have labels of
    their own, and a simulation step named HLT also writes generator particles and the truth graph)."""

    def __init__(self, items, classes=None):
        self.items = list(items)
        self.classes = classes or {}  # branch name -> class of the product, where known

    def has(self, module, instance="", product_type=None):
        return any(p.module == module and p.instance == instance and product_type in (None, p.type) for p in self.items)

    def modules(self, product_type):
        """The module labels of the offline products of a type (no instance, not the HLT's), in file order."""
        offline = (p.module for p in self.items if p.type == product_type and not p.instance)
        return list(dict.fromkeys(m for m in offline if not m.startswith("hlt")))

    def soa(self):
        """The SoA (portable host) collections in the input."""
        return sorted({f"{p.module}" for p in self.items if "PortableHostCollection" in p.type})
