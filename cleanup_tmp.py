import os, shutil
repo = os.path.expanduser("~/code/harnessview")
for f in ["scripts/auto-publish.mjs", "scripts/auto-publish.py",
          "scripts/npm-safari-signup.py", "scripts/test-safari.py",
          "scripts/test-safari2.py"]:
    p = os.path.join(repo, f)
    if os.path.exists(p):
        os.remove(p)
        print(f"removed {f}")
tmp = os.path.join(repo, "tmp")
if os.path.isdir(tmp):
    shutil.rmtree(tmp)
    print("removed tmp/")
