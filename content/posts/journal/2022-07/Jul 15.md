---
date: 2022-07-15T18:58:39+03:00
Author: Artefaktas
Tags: ["new_post"]
draft: false
title: Jul 15
---

# Jul 15

> [!tldr] Jul 15
> There is nothing to read yet. This is a test post.

## Testing my new toolkit

I guess I made something fascinating today. I mixed a couple of well-known technologies and here we are.

Everytime I run a shell command to sync latest posts, with the help of Hugo, Github and Cloudflare pages, new posts appear online with almost no effort.

> [!hint] Hint
>
> ```
> #!/bin/bash
> CURRENTDATE=`date +"%Y-%m-%d %T"`
> hugo
> git add * -f
> message="Obsidian update: "$CURRENTDATE
> git commit -m "$message"
> git push
> ```

Internal links if exists:

External links if exist:
