/*
    Agora Forum Software
    Copyright (C) 2016 Gregory Sartucci
    License: GPL, Check file LICENSE
*/

Meteor.methods({
    sendVerificationLink: function() {
        let userId = Meteor.userId();
        if ( userId ) {
            return Accounts.sendVerificationEmail( userId );
        }
    },
    insertPost: function(post) {
        let user = Meteor.users.findOne({_id: this.userId});

        //Don't allow guests to post.
        if (!user) {
            throw new Meteor.Error('not-logged-in', 'The user must be logged in to post.');
        }

        //Don't allow banned users to post.
        if (user.isBanned) {
            throw new Meteor.Error('banned', 'Banned users may not post.');
        }

        //Don't allow unverified users to post.
        if (!user.emails || user.emails.length < 1 || !user.emails[0].verified) {
            throw new Meteor.Error('unverified', 'Unverified users may not post.');
        }

        //Validate post.
        if (post.title && post.title.length < 1) {
            delete post.title;
        }

        if (!post.target) {
            return;
        }

        let target = Posts.findOne({_id: post.target});
        if (!target) {
            return;
        }

        //check post for new hashtags and if any are found process them.
        //The regex here describes a hashtag as anything that starts with either
        //the start of a string or any kind of whitespace, then has a # symbol,
        //and then any  number of letters.
        let postTags = post.content.match(/(^|\s)(#[a-z\d][\w-]*)/gi);

        if(!post.tags) post.tags = [];

        if (postTags) {

            for (let newTag of postTags) {
                newTag = newTag.trim().toLowerCase();
                newTag = newTag.replace("#", "");

                console.log(newTag);

                //check for any new tags not already present on the post.
                if (post.tags.find(function(tag) {
                    return tag === newTag;
                }) === undefined) {
                    //if any are found, add them to the list of new tags on the
                    //post.
                    post.tags.push(newTag);
                }
            }
        }

        //Validate against schema. TODO: Fix validation redundancy--also validates upon insert.
        Schema.Post.validate(post);

        //Will always insert after the targets rightmost reply, shifting existing posts to the right.
        let y = target.defaultPosition.y - 1;
        let x = target.defaultPosition.x;
        post.defaultPosition = {x: x, y: y};

        /**add the post to the end of the line under the post it's replying to.
            *find every sibling post of it's parent that's to the right of it, and of their parents, and move them all \
            to the right.

            while
            	find parent of current target
            	check if any of it's siblings are to the right of the inserted post
            	if so add them to the list to move further right.*/

        //Find the chain of posts which need to be adjusted.
        if (target.replies.length > 0) {
            let shifting = false;
            let postsToShift = [];
            let targetId = target.target;

            redoLayout = true; //This variable is checked by the code in periodicLayout.js

            //posts above...
            while (targetId) {
                Posts.find({target: targetId}, {sort: {'defaultPosition.x': 1}}).forEach(function(post) {

                    //first, increase the size of their subtree variables by 1.
                    Posts.update({_id: post._id}, {$inc: {subtreeWidth: 1}});

                    //Then check if we need to add it to the list of posts to shift.
                    if (shifting) {
                        if (post.defaultPosition.x <= x) {
                            shifting = false;
                        }
                    }
                    else if (post.defaultPosition.x > x) {
                        shifting = true;
                    }

                    if (shifting) {
                        postsToShift.push(post);
                    }
                });

                targetId = Posts.findOne({_id: targetId}).target;
            };

            //...and all of a posts siblings.
            for (let id of target.replies) {
                let post = Posts.findOne({_id: id});
                if (post)
                    postsToShift.push(post);
                else {
                    console.log("Error! Undefined post!")
                    console.log(target);
                }
            }

            //Shift found posts one column to the right, and all of their children, too.
            for (let post of postsToShift) {
                if (!post)
                    continue;
                let newColumn = post.defaultPosition.x + 1;
                Posts.update({_id: post._id}, {$set: {'defaultPosition.x': newColumn}});
                Posts.find({target: post._id}).forEach(function(child) {
                    postsToShift.push(child);
                });
            }

        }

        //Insert new post into position.
        let postId = Posts.insert(post);
        Posts.update({_id: post.target}, {$push: {replies: postId}});

        //add any new tags to the database, and adjust the info for existing tags accordingly.
        for (let tag of post.tags) {
            let tagDocument = Tags.findOne({_id: tag});
            if (!tagDocument) {
                Tags.insert({_id: tag, postNumber: 1, posts: [postId]});
                tagDocument = Tags.findOne({_id: tag});
            } else {
                Tags.update({_id: tag}, { $inc: {postNumber: 1}, $push: {posts: postId} });
                tagDocument = Tags.findOne({_id: tag});
            }
        }

        return postId;
    },
    editPost: function(postId, update) {
        let user = Meteor.users.findOne({_id: this.userId});

        //Don't allow guests to edit posts.
        if (!user) {
            throw new Meteor.Error('not-logged-in', 'The user must be logged in to edit posts.');
        }

        //Don't allow banned users to edit posts.
        if (user.isBanned) {
            throw new Meteor.Error('banned', 'Banned users may not edit posts.');
        }

        //Don't allow unverified users to edit posts.
        if (!user.emails || user.emails.length < 1 || !user.emails[0].verified) {
            throw new Meteor.Error('unverified', 'Unverified users may not edit posts.');
        }

        let post = Posts.findOne({_id: postId});

        //Don't allow non-moderators to edit other peoples posts.
        if (post.poster !== this.userId && !Roles.userIsInRole(this.userId, ['moderator'])) {
            throw new Meteor.Error('post-not-owned', 'Only moderators may edit posts they don\'t own.');
        }

        //Validate edit.
        if (post.title && post.title.length < 1) {
            delete post.title;
        }

        //check post for new tags and process them if found.
        let postTags = update.content.match(/(^|\s)(#[a-z\d][\w-]*)/gi);

        if(!update.tags) update.tags = [];

        if (postTags) {

            for (let newTag of postTags) {
                newTag = newTag.trim().toLowerCase();

                //check for any new tags not already present on the post.
                if (update.tags.find(function(tag) {
                    return tag === newTag;
                }) === undefined) {
                    //if any are found, add them to the list of new tags on the
                    //post.
                    update.tags.push(newTag);

                    let tagDocument = Tags.findOne({_id: newTag});
                    if (!tagDocument) {
                        Tags.insert({_id: newTag, postNumber: 1, posts: [postId]});
                        tagDocument = Tags.findOne({_id: newTag});
                    } else {
                        Tags.update({_id: newTag}, { $inc: {postNumber: 1}, $push: {posts: postId} });
                        tagDocument = Tags.findOne({_id: newTag});
                    }

                }
            }
        }

        //Edit post.
        Posts.update({_id: postId}, {$set: {
            title: update.title,
            content: update.content,
            lastEditedAt: Date.now()
        }});
    },
    deletePost: function(postId) {
        let post = Posts.findOne({_id: postId});

        //Don't allow non-moderators to delete posts.
        if (!Roles.userIsInRole(this.userId, ['moderator'])) {
            throw new Meteor.Error('not-logged-in', 'Only moderators may delete posts.');
        }

        //check to make sure the post exists before attempting to delete it.
        if (post === undefined) {
            throw new Meteor.Error('post-not-found', 'No such post was found.');
        }

        //recursively delete all replies to the post.
        post.replies.forEach(function(reply) {
            Meteor.call('deletePost', reply);
        });

        let target = Posts.findOne({_id: post.target});
        let x = post.defaultPosition.x;


        //Adjust positioning of other posts in graph appropriately, if necessary.
        if (target && target.replies.length > 1) {
            let shifting = false;
            let postsToShift = [];
            let targetId = target.target;

            redoLayout = true; //This variable is checked by the code in periodicLayout.js

            //posts above...
            while (targetId) {
                Posts.find({target: targetId}, {sort: {'defaultPosition.x': 1}}).forEach(function(post) {

                    //first, decrease the size of their subtree variables by 1.
                    Posts.update({_id: post._id}, {$inc: {subtreeWidth: -1}});

                    //Then check if we need to add it to the list of posts to shift.
                    if (shifting) {
                        if (post.defaultPosition.x <= x) {
                            shifting = false;
                        }
                    }
                    else if (post.defaultPosition.x > x) {
                        shifting = true;
                    }

                    if (shifting) {
                        postsToShift.push(post);
                    }
                });

                targetId = Posts.findOne({_id: targetId}).target;
            };

            shifting = false;

            //...and all of a posts siblings that are right of them.
            for (let id of target.replies) {
                let post = Posts.findOne({_id: id});
                if (post) {
                    if (shifting) {
                        if (post.defaultPosition.x <= x) {
                            shifting = false;
                        }
                    }
                    else if (post.defaultPosition.x > x) {
                        shifting = true;
                    }

                    if (shifting) {
                        postsToShift.push(post);
                    }
                } else {
                    console.log("Error! Undefined post!")
                    console.log(target);
                }
            }

            //Shift found posts one column to the left, and all of their children, too.
            for (let post of postsToShift) {
                if (!post)
                    continue;
                let newColumn = post.defaultPosition.x - 1;
                Posts.update({_id: post._id}, {$set: {'defaultPosition.x': newColumn}});
                Posts.find({target: post._id}).forEach(function(child) {
                    postsToShift.push(child);
                });
            }

        }

        //delete the post and all references to it.
        Posts.update({_id: post.target}, {$pull: {replies: postId}});
        Posts.remove(postId);
    },
    submitReport: function(report) {
        let user = Meteor.users.findOne({_id: this.userId});

        //Don't allow guests to submit reports.
        if (!user) {
            throw new Meteor.Error('not-logged-in', 'The user must be logged in to submit reports.');
        }

        //Don't allow banned users to submit reports.
        if (user.isBanned) {
            throw new Meteor.Error('banned', 'Banned users may not submit reports.');
        }

        //Don't allow unverified users to submit reports.
        if (!user.emails || user.emails.length < 1 || !user.emails[0].verified) {
            throw new Meteor.Error('unverified', 'Unverified users may not submit reports.');
        }

        if (report.content.length >= 1)
            return Reports.insert(report);
    },
    resolveReport: function(report) {
        if (Roles.userIsInRole(this.userId, ['moderator']))
        return Reports.update({_id: report._id},
            {$set: {resolved: true} });
    },
    updateUserBio: function(newBio) {
        let user = Meteor.users.findOne({_id: this.userId});

        //Don't allow guests to try and edit profiles.
        if (!user) {
            throw new Meteor.Error('not-logged-in', 'The user must be logged in to edit posts.');
        }

        //Don't allow banned users to edit profiles.
        if (user.isBanned) {
            throw new Meteor.Error('banned', 'Banned users may not edit posts.');
        }

        //Update field.
        Meteor.users.update({_id: this.userId}, {$set: {bio: newBio}});
    },
    addSeenPost: function(postID) {
        let user = Meteor.users.findOne({_id: this.userId});

        //Guests can't record seen posts.
        if (!user) {
            throw new Meteor.Error('not-logged-in', 'The user must be logged in to record seen posts.');
        }

        let post = Posts.findOne({_id: postID});

        if (!post.postedOn) {
            throw new Meteor.Error('undated-post', 'That post does not have a date and is thus assumed to be to old to be worth recording as seen.');
        }

        if (post.poster == this.userId) {
            throw new Meteor.Error('own-post', 'A user is assumed to have always seen their own posts.');
        }

        if (Date.now() - post.postedOn >= (1000*60*60*24*30)) {
            throw new Meteor.Error('old-post', 'Posts older than a month are assumed to have always been seen.');
        }

        if (user.seenPosts && user.seenPosts.find(function(p) {
            return postID == p._id;
        })) {
            throw new Meteor.Error('already-seen', 'The user has already seen that post.');
        }

        //Update field.
        Meteor.users.update({_id: this.userId}, {$push: {seenPosts: postID}});
    }
});
