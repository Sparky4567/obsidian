#!/bin/bash
CURRENTDATE=`date +"%Y-%m-%d %T"`
git add themes/* -f
git add content/* -f
git add public/* -f
message="Obsidian update: "$CURRENTDATE
git commit -m "$message"
git push