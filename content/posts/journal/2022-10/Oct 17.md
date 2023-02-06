---
date: 2022-10-17T15:00:54+03:00
Author: Artefaktas
Tags: ["new_post", "external", "apps", "grammarly", "web", "page"]
draft: false
title: Oct 17
---

# Oct 17

> [!tldr] Oct 17
> You were searching for a way to use Grammarly in your notes. Here it is.

Boy, oh boy. The majority of this site visitors come here to check if there is even the slightest possibility to use the Grammarly plugin in Obsidian Notes. The short answer is no. There is no possibility to use the plugin.

On the other hand, due to raised traffic, I had to find another way to use Grammarly without any external apps.

Somehow and somewhy I decided to visit Grammarly's developer page and to my surprise, I found some useful information on implementing the grammar checking feature. A little bit of REACT, a few minutes of templating, some Javascript magic and... If you want to use Grammarly in your notes, you can add a special template into your note. All you need is just an internet connection to be able to use the template.

So the idea is quite simple actually. I made a separate WEB page and implemented the Grammarly SDK. Furthermore, I did not include any unnecessary security restrictions so that the page could be shared as an IFRAME. Therefore, you can implement it into your pages as a template using a shortcode.

```
<iframe src="https://grammarplugin.artefaktas.eu/" width="100%" height="600"></iframe>
```

You can support my little project by clicking the "Support me" option within the IFRAME.

Inner Tags: #new_post #grammarly #october

Internal links if exist:

External links if exist:

Markdown external:
