#!/bin/bash
CURRENTDATE=`date +"%Y-%m-%d %T"`
git add * content/posts/ideas -f
git add * content/posts/journal -f
git add * content/posts/kanban -f
git add * content/posts/templates -f
git add * content/posts/themelist -f
git add * public -f
message="Obsidian update: "$CURRENTDATE
git commit -m "$message"
git push