#!/usr/bin/env python3
"""AC-18 checks on turbo.json and the build dry-run graph. Usage: graph.py turbo.json build-dry.json"""
import json, sys

turbo = json.load(open(sys.argv[1]))
dry = json.load(open(sys.argv[2]))
tasks = turbo["tasks"]
problems = []

# 1. Transitive dependencies of every build task in the dry-run graph.
deps = {t["taskId"]: t.get("dependencies", []) for t in dry["tasks"]}
seen = set()
def walk(task):
    for dep in deps.get(task, []):
        if dep not in seen:
            seen.add(dep)
            walk(dep)
for task in list(deps):
    if task.endswith("#build"):
        walk(task)
print("build graph tasks:", sorted(deps))
print("transitive dependencies of build tasks:", sorted(seen))
forbidden = lambda name: name.split("#")[-1] in ("migrate", "contract:generate") or name.split("#")[-1].startswith("test:")
for name in sorted(seen | {t for t in deps}):
    if forbidden(name) and not name.endswith("#build"):
        problems.append(f"build graph contains {name}")

# 2. turbo.json closure: build -> dependsOn -> ...
def closure(start):
    out, todo = set(), [start]
    while todo:
        cur = todo.pop()
        for dep in tasks.get(cur, {}).get("dependsOn", []):
            name = dep.lstrip("^")
            if "#" in name:
                name = name.split("#", 1)[1]
            if name not in out:
                out.add(name)
                todo.append(name)
    return out
reach = closure("build")
print("turbo.json dependsOn closure of build:", sorted(reach))
for name in sorted(reach):
    if forbidden(name):
        problems.append(f"turbo.json: build depends on {name}")

# 3. Side-effect tasks are uncached.
def find(name):
    for key in (name, "//#" + name):
        if key in tasks:
            return key, tasks[key]
    return None, None
for name in ("migrate", "contract:generate", "test:integration", "test:runtime", "test:e2e"):
    key, cfg = find(name)
    if cfg is None:
        problems.append(f"{name}: not defined in turbo.json")
    elif cfg.get("cache") is not False:
        problems.append(f"{key}: cache is not false")
    else:
        print(f"{key}: cache false")

# 4. dev is persistent, interruptible and uncached.
dev = tasks.get("dev")
if not dev:
    problems.append("dev: not defined")
else:
    for flag, want in (("persistent", True), ("interruptible", True), ("cache", False)):
        if dev.get(flag) is not want:
            problems.append(f"dev.{flag} is {dev.get(flag)!r}, expected {want!r}")
    print("dev:", json.dumps(dev))

for p in problems:
    print("PROBLEM:", p)
sys.exit(1 if problems else 0)
