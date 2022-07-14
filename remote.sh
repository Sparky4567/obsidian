#!/bin/bash
CURRENTDATE=`date +"%Y-%m-%d %T"`
git add . -f
message="Obsidian update: "$CURRENTDATE
git commit -m "$message"
git push