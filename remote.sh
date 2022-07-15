#!/bin/bash
CURRENTDATE=`date +"%Y-%m-%d %T"`
/usr/bin/hugo
git add * -f
message="Obsidian update: "$CURRENTDATE
git commit -m "$message"