#!/bin/bash
CURRENTDATE=`date +"%Y-%m-%d %T"`
hugo
git add public -f
message="Obsidian update: "$CURRENTDATE
git commit -m "$message"