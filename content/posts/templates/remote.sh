#!/bin/bash
cd ../../../
CURRENTDATE=`date +"%Y-%m-%d %T"`
hugo
git add * -f
message="Obsidian update: "$CURRENTDATE
git commit -m "$message"