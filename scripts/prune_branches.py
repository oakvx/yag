#!/usr/bin/env python3
"""Prune obsolete YAG branches after a successful merge to main.

Conservative rules: only closed-PR heads still at the exact reviewed SHA,
or two known obsolete release-candidate trigger branches. Never delete main,
protected branches, branches with an open PR, or branches moved since review.
Default is read-only; --execute explicitly authorizes GitHub ref deletions.
"""
import argparse
import json
import os
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPO = "oakvx/yag"
LEGACY_RELEASE_TRIGGERS = {
    "release-candidate/v0.1.0-rc.1",
    "release-candidate/v0.1.0-rc.2",
}


def planned_deletions(branches, pulls):
    open_heads = {
        pr["head"]["ref"]
        for pr in pulls
        if pr.get("state") == "open" and pr.get("head")
           and (pr["head"].get("repo") or {}).get("full_name") == REPO
    }
    closed_heads = {}
    for pr in pulls:
        if pr.get("state") != "closed" or not pr.get("head"):
            continue
        head = pr["head"]
        if (head.get("repo") or {}).get("full_name") != REPO:
            continue
        if head.get("ref") and head.get("sha"):
            closed_heads.setdefault(head["ref"], set()).add(head["sha"])
    result = []
    for branch in branches:
        name = branch.get("name")
        sha = (branch.get("commit") or {}).get("sha")
        if not name or not sha or name == "main" or branch.get("protected") or name in open_heads:
            continue
        if sha in closed_heads.get(name, set()) or name in LEGACY_RELEASE_TRIGGERS:
            result.append((name, sha))
    return sorted(result)


def api(path, token, method="GET"):
    req = Request(
        "https://api.github.com/repos/" + REPO + "/" + path,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "YAG-safe-branch-prune",
        },
        method=method,
    )
    with urlopen(req, timeout=20) as response:
        if method == "DELETE":
            return None
        return json.load(response)


def paged(collection, token, params=""):
    values = []
    for page in range(1, 20):
        tail = "&" + params if params else ""
        data = api(f"{collection}?per_page=100&page={page}{tail}", token)
        if not isinstance(data, list):
            raise ValueError("Unexpected paged GitHub response")
        values.extend(data)
        if len(data) < 100:
            break
    else:
        raise RuntimeError("Pagination limit reached: refusing incomplete cleanup")
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Delete only the verified obsolete refs")
    args = parser.parse_args()
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        parser.error("GH_TOKEN/GITHUB_TOKEN is required")
    branches = paged("branches", token)
    pulls = paged("pulls", token, "state=all")
    plan = planned_deletions(branches, pulls)
    print(f"YAG obsolete branch candidates: {len(plan)}; execute={args.execute}")
    if len(plan) > 100:
        raise RuntimeError("Over 100 candidates: refusing unexpected bulk deletion")
    count = 0
    for name, reviewed_sha in plan:
        if not args.execute:
            print("DRY RUN", name)
            continue
        # Re-read immediately before deletion to avoid stale PR/branch snapshots.
        try:
            live = api("branches/" + quote(name, safe="/"), token)
        except HTTPError as exc:
            if exc.code == 404:
                continue
            raise
        if live.get("protected") or (live.get("commit") or {}).get("sha") != reviewed_sha:
            print("SKIPPED (moved or protected)", name)
            continue
        # An open PR added since listing must protect its head.
        current_open = paged("pulls", token, "state=open")
        if any(pr.get("head", {}).get("ref") == name
               and (pr.get("head", {}).get("repo") or {}).get("full_name") == REPO
               for pr in current_open):
            print("SKIPPED (active PR)", name)
            continue
        api("git/refs/heads/" + quote(name, safe="/"), token, "DELETE")
        count += 1
        print("DELETED", name)
    print(f"Deleted {count} obsolete branches. main and active work were not touched.")


if __name__ == "__main__":
    main()
