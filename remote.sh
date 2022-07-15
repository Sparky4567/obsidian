#!/bin/bash
CURRENTDATE=`date +"%Y-%m-%d %T"`
git add themelist -f
git add ideas -f
git add journal -f
git add kanban -f
git add templates -f
git add remote.sh
message="Obsidian update: "$CURRENTDATE
git commit -m "$message"
git push