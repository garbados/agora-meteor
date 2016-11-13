currentAction = "none";

Template.forumIndex.rendered = function() {
    var init = true;

    var nodesCursor = Post.find({}), linksCursor = Link.find({});

    tree = new ForumTree(this, nodesCursor, linksCursor);

    nodesCursor.observe({
        added: function(doc) {
            if (init) return;
            if (doc.isRoot) {
                doc.type = "post";
                tree.addNode(doc);
            }
        },
        removed: function(doc) {
            if (init) return;
            tree.removeNode(doc);
        }
    });

    linksCursor.observe({
        added: function(doc) {
            if (init) return;
            if (nodesInGraph.findOne({_id: doc.sourceId})) {
                handlers.addHandler(doc.targetId);
            } else if (nodesInGraph.findOne({_id: doc.targetId})) {
                handlers.addHandler(doc.sourceId);
            }
            tree.addLink(doc);
        },
        removed: function(doc) {
            if (init) return;
            tree.removeLink(doc);
        }
    });

    tree.runGraph();
    tree.render();
    init = false;
};

function linksToD3Array(linksCol, nodesCol) {
    var nodes = {};
    nodesCol.forEach(function(n) {
        nodes[n._id] = n;
    });
    var result = [];
    linksCol.forEach(function(link) {
        if (link.source && link.target) {
            result.push(link);
        } else {

            var tmp = {
                source: nodes[link.sourceId],
                target: nodes[link.targetId],
                type: link.type,
                _id: link._id
            };

            if (tmp.source && tmp.target) {
                result.push(tmp);
            }
        }
    });
    return result;
};

function ForumTree(forumIndex, nodesCursor, linksCursor) {
    this.forumIndex = forumIndex;

    var postWidth = 140, postHeight = 100;

    //put nodes and links into D3-friendly arrays
    this.nodes = [];
    this.links = [];



    this.findNode = function(doc) {
        if (doc._id)
            return this.nodes.find(function(n) {return (doc._id == n._id)});
        else return this.nodes.find(function(n) {return (doc == n._id)});
    };

    this.findLink = function(doc) {
        if (doc._id)
            return this.links.find(function(l) {return (doc._id == l._id)});

        if (!doc.source || !doc.target) var link = linksToD3Array([doc], this.nodes)[0];
        else var link = doc;
        return this.links.find(function(l) {return (link.source == l.source && link.target == l.target)});
    };

    this.containsNode = function(doc) {
        if (this.findNode(doc)) return true;
        else return false;
    };

    this.containsLink = function(doc) {
        if (this.findLink(doc))
            return false;
    };

    this.addNode = function(doc) {
        if (!this.nodes.find(function(n) {return (doc._id == n._id)})) {
            let _id = doc._id;
            if (!nodesInGraph.findOne({_id: doc._id}))
                _id = nodesInGraph.insert(doc);

            doc = nodesInGraph.findOne({_id: _id});
            this.nodes.push(doc);

            return this.nodes[this.nodes.length - 1];
        }
        return false;
    };

    this.addLink = function(doc) {
        //DANGER!
        if (!doc._id) {
            var _id = nodesInGraph.insert(doc);
            doc = nodesInGraph.findOne({_id: _id});
        }
        //THIS IS AN AWFUL HACK!
        //We are inserting links that don't have _id's into the local
        //nodesInGraph database purely for the purpose of getting them ids.

        let link = linksToD3Array([doc], this.nodes)[0];
        if (link && !this.containsLink(doc)) {
            this.links.push(link);
            this.runGraph();
            this.render();
            return true;
        }
        return false;
    };

    this.removeNode = function(doc) {
        var iToRemove = -1;
        if (this.nodes.length !== 0) {
            this.nodes.forEach(function(node, i) {
                if (node._id === doc._id) {
                    iToRemove = i;
                }
            });
        }
        if (iToRemove != -1) {
            for (i = 0; i < this.links.length;) {
                link = this.links[i];
                if (link.source._id === doc._id || link.target._id == doc._id)
                    this.links.splice(i, 1);
                else i++;
            }
            this.nodes.splice(iToRemove, 1);
            nodesInGraph.remove({_id: doc._id});
            this.runGraph();
            this.render();
            return true;
        }
        return false;
    };

    this.removeLink = function(doc) {
        var iToRemove = -1;
        this.links.forEach(function(link, i) {
            if (link._id === doc._id) {
                iToRemove = i;
            } else if (link.source._id == doc.sourceId && link.target._id == doc.targetId) {
                iToRemove = i;
            }
        });
        if (iToRemove != -1) {
            this.links.splice(iToRemove, 1);
            this.runGraph();
            this.render();
            return true;
        }
        return false;
    };

    var tree = this;
    nodesCursor.forEach(function(n) {
        n.type = "post";
        if (n.isRoot || nodesInGraph.findOne({_id: n._id}))
            tree.addNode(n);
    });
    this.links = linksToD3Array(linksCursor, this.nodes);

    //find our SVG element for the forumIndex template and assign our SVG variable to it as a reference.
    //Then, beloy that add code so that when we're adding new links to the graph,
    //it will draw them to the mouse cursor as it's moved around.
    var svg = d3.select("#posts-graph");

    svg.selectAll("*").remove();

    var linksGroup = svg.append("g");
    var linkElements = linksGroup.selectAll("line");

    // init force layout
    var force = d3.layout.force()
        .nodes(this.nodes)
        .links(this.links)
        .gravity(0.10)
        .charge(-20000)
        .chargeDistance(400)
        .friction(0.9)
        .linkStrength(0.3)
        .linkDistance(function(link) {
            let linkDistance = 0;
            linkDistance += $("#post-" + link.source._id).outerHeight() / 2;
            linkDistance += $("#post-" + link.target._id).outerHeight() / 2;
            linkDistance *= 3;
            return linkDistance;
        })
        .on("tick", tick);

    this.force = force;

    // setup z-index to prevent overlapping lines over nodes

    resize();
    d3.select(window).on("resize", resize);

    // tick
    function tick(e) {
        //This if statement keeps the app from choking when reloading the page.
        if (!force.nodes()[0] || !force.nodes()[0].y) { return; }

        var links = force.links();
        var nodes = force.nodes();

        var k = 6 * e.alpha;
        links.forEach(function(d, i) {
            if (d.source.y < d.target.y + 160) {
                d.source.y += 1;
                d.target.y -= 1;
            }
        });
    }

    // resize svg and force layout when screen size change
    function resize() {
        var width = window.innerWidth, height = window.innerHeight;
        svg.attr("width", width).attr("height", height);
        force.size([width, height]);
    }

    this.runGraph = function() {
        force.start();
        for (var i = 0; i < 1000; i++) force.tick();
        force.stop();
    }

    // dynamically update the graph
    this.render = function() {

        // add links
        contextMenuShowing = false;

        linkElements = linkElements.data(force.links(), function(d, i) { return d._id; });
        linkElements.exit().remove();

        var edgeSelection = linkElements.enter().append("line")
            .classed('link', true)
            .attr('stroke', function (d) {
                if (d.type == "Attack") {
                    return 'red';
                } else {
                    return 'black';
                }
            });

        linkElements
            .attr("x1", function (d) {
                return d.source.x;
            })
            .attr("y1", function (d) {
                return d.source.y;
            })
            .attr("x2", function (d) {
                return d.target.x;
            })
            .attr("y2", function (d) {
                return d.target.y;
            });

        this.nodes.forEach(function(d) {
            if (d.type == "post") {
                let post = $("#post-" + d._id);
                let xAdjust = (post.outerWidth() / 2);
                let yAdjust = (post.outerHeight() / 2);
                post.css("left", d.x - xAdjust).css("top", d.y - yAdjust);
            } else if (d.type == "reply") {
                $("#reply-" + d._id).css("left", d.x - 160).css("top", d.y - 112);
            }
        });
    };

    return this;
}
