"""Legacy CLI `run` / `run-noideate` generation selector: `[N]` = last N gens, `genNNN` = one gen.

Exercises the real CSV engine on a real temp file: what workers claim and what the
orchestrator counts as pending must both respect the window, or the runner spins.
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "lib"))
# AIDEV-NOTE: the plugin's tests import plugin/lib as the package `lib` (via
# ideate_branch -> evolve_common). In one pytest process that cached package then
# shadows the legacy CLI's lib/, and `from lib.meta_learning import ...` fails. Drop
# it so the legacy lib/ resolves from ROOT.
for _name in [m for m in sys.modules if m == "lib" or m.startswith("lib.")]:
    del sys.modules[_name]
from evolution_csv import EvolutionCSV  # noqa: E402
from evolve_run import generation_window  # noqa: E402

CSV = """id,basedOnId,description,performance,status
gen01-001,,a,,pending
gen820-001,,b,1.0,complete
gen821-001,,c,,pending
gen822-001,,d,,pending
gen822-002,,e,,pending
gen823-001,,f,,pending
"""


def claim_all(path, window):
    lo, hi = window if window else (None, None)
    out = []
    with EvolutionCSV(str(path)) as c:
        while (r := c.get_next_pending_candidate(min_generation=lo, max_generation=hi)):
            out.append(r[0])
    return out


def pending(path, window):
    lo, hi = window if window else (None, None)
    with EvolutionCSV(str(path)) as c:
        return c.get_csv_stats(min_generation=lo, max_generation=hi)["pending"]


@pytest.fixture
def csv_path(tmp_path):
    p = tmp_path / "evolution.csv"
    p.write_text(CSV)
    return p


def test_last_n_generations(csv_path):
    w = generation_window("2", 823)
    assert w == (822, None)
    assert pending(csv_path, w) == 3
    assert sorted(claim_all(csv_path, w)) == ["gen822-001", "gen822-002", "gen823-001"]


def test_specific_generation(csv_path):
    w = generation_window("gen822", 823)
    assert w == (822, 822)
    assert pending(csv_path, w) == 2
    assert sorted(claim_all(csv_path, w)) == ["gen822-001", "gen822-002"]


def test_zero_padded_generation(csv_path):
    assert generation_window("gen01", 823) == (1, 1)
    assert claim_all(csv_path, generation_window("gen01", 823)) == ["gen01-001"]


def test_no_selector_is_everything(csv_path):
    assert generation_window(None, 823) is None
    assert len(claim_all(csv_path, None)) == 5


@pytest.mark.parametrize("bad", ["0", "-3", "gen", "genx", "822x", "foo"])
def test_bad_selector_fails_loud(bad):
    with pytest.raises(ValueError):
        generation_window(bad, 823)
