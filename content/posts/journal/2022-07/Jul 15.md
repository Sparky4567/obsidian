---
date: 2022-07-15T18:58:39+03:00
Author: Artefaktas
Tags: ["new_post", "first", "post", "jul", "2022"]
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
>
> CURRENTDATE=`date +"%Y-%m-%d %T"`
>
> hugo
>
> git add * -f
>
> message="Obsidian update: "$CURRENTDATE
>
> git commit -m "$message"
>
> git push
>
> ```

## Final solution

If you want to replicate this

Create a file called remote.sh

Insert this code inside

```

#!/bin/bash

CURRENTDATE=`date +"%Y-%m-%d %T"`

git add content -f

git add public -f

message="Obsidian update: "$CURRENTDATE

git commit -m "$message"

git push


```

**Create a good-named alias in your ~/.bashrc file**

For example:

```

alias obsidianbuild="cd /home/yourusername/Desktop/vaults/interconnection/ && hugo && ./remote.sh"

```

**Source your ~/.bashrc**

```

source ~/.bashrc

```

## Open your terminal

**And run a command**

```

obsidianbuild

```

Internal links if exist:

External links if exist:
