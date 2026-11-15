import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location(
    "prune_branches", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "prune_branches.py"
)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def branch(name,sha="a",protected=False):
    return {"name":name,"protected":protected,"commit":{"sha":sha}}

def pr(name,sha="a",state="closed",repo="oakvx/yag"):
    return {"state":state,"head":{"ref":name,"sha":sha,"repo":{"full_name":repo}}}

class PrunePolicy(unittest.TestCase):
    def test_removes_only_closed_reviewed_head_sha(self):
        branches=[branch("main"),branch("feat/done"),branch("feat/moved","new"),
                  branch("feat/open"),branch("feat/protected",protected=True),
                  branch("feat/unknown"),branch("feat/fork")]
        prs=[pr("feat/done"),pr("feat/moved"),pr("feat/open",state="open"),
             pr("feat/protected"),pr("feat/fork",repo="someone/fork")]
        self.assertEqual(mod.planned_deletions(branches,prs),[("feat/done","a")])

    def test_reviewed_obsolete_shas_are_exact_and_never_delete_new_work(self):
        name="feat/console-private-node-wizard"
        reviewed=mod.LEGACY_OBSOLETE_HEADS[name]
        self.assertEqual(mod.planned_deletions([branch(name,reviewed)],[]),
                         [(name,reviewed)])
        self.assertEqual(mod.planned_deletions([branch(name,"new-commit")],[]),[])
        self.assertEqual(mod.planned_deletions([branch(name,reviewed,True)],[]),[])
        self.assertEqual(mod.planned_deletions(
            [branch(name,reviewed)],[pr(name,reviewed,state="open")]),[])

    def test_known_release_triggers_only_when_no_active_pr(self):
        branches=[branch("release-candidate/v0.1.0-rc.1"),
                  branch("release-candidate/v0.1.0-rc.2"),
                  branch("release-candidate/v0.2.0-rc.1")]
        self.assertEqual(mod.planned_deletions(branches,[]),[
            ("release-candidate/v0.1.0-rc.1","a"),
            ("release-candidate/v0.1.0-rc.2","a"),
        ])
        self.assertEqual(mod.planned_deletions(branches,[
            pr("release-candidate/v0.1.0-rc.1",state="open")
        ]),[("release-candidate/v0.1.0-rc.2","a")])

if __name__ == "__main__":
    unittest.main()
